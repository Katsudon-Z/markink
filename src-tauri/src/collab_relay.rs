// Yjs 同期中継 (TCP フォールバック):
// P2P (WebRTC/UDP) が不通の環境でも、ホストの TCP サーバ経由で
// Yjs 文書同期が成立するよう y-websocket 互換プロトコルを実装する。
// クライアントは y-websocket の WebsocketProvider を同じ Y.Doc に接続する。
// Yjs の更新は冪等なため、P2P と中継の二重配送でも収束する。
//
// 経路: ws://host:42100/<room> (パスがルーム名、URLエンコード済み)
// バイナリメッセージ: y-websocket 形式 [varUint種別, ...]
//   0=sync (step1/step2/update), 1=awareness, 3=queryAwareness

use std::collections::HashMap;
use std::sync::Mutex as StdMutex;

use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use yrs::sync::{Awareness, DefaultProtocol, Message as SyncMessage, Protocol};
use yrs::updates::encoder::Encode;
use yrs::{Doc, Transact};

pub type Tx = mpsc::UnboundedSender<Message>;

struct RelayRoom {
    _doc: Doc,
    awareness: Awareness,
    subs: HashMap<u64, Tx>,
    /// 診断用: 受信バイナリ数 / 転送バイナリ数
    rx_messages: u64,
    tx_messages: u64,
}

impl RelayRoom {
    fn new() -> Self {
        let doc = Doc::new();
        let awareness = Awareness::new(doc.clone());
        Self { _doc: doc, awareness, subs: HashMap::new(), rx_messages: 0, tx_messages: 0 }
    }
}

static RELAY: std::sync::LazyLock<StdMutex<HashMap<String, RelayRoom>>> =
    std::sync::LazyLock::new(|| StdMutex::new(HashMap::new()));

fn room_of(path: &str) -> Option<String> {
    let first = path.trim_start_matches('/').split('/').next().unwrap_or("");
    if first.is_empty() {
        None
    } else {
        Some(urlencoding::decode(first).map(|s| s.into_owned()).unwrap_or_else(|_| first.to_string()))
    }
}

/// 接続時の所属判定。戻り値はルーム名 (None の場合はシグナリング側で処理)
pub fn relay_route(path: &str) -> Option<String> {
    room_of(path)
}

pub fn relay_subscribe(room_name: &str, client_id: u64, tx: Tx) {
    let mut rooms = RELAY.lock().unwrap();
    rooms
        .entry(room_name.to_string())
        .or_insert_with(RelayRoom::new)
        .subs
        .insert(client_id, tx);
}

pub fn relay_unsubscribe(client_id: u64) {
    let mut rooms = RELAY.lock().unwrap();
    let mut empty = Vec::new();
    for (name, room) in rooms.iter_mut() {
        room.subs.remove(&client_id);
        if room.subs.is_empty() {
            empty.push(name.clone());
        }
    }
    for name in empty {
        rooms.remove(&name);
    }
}

/// 自分宛ての応答送信用に tx を取得
pub fn relay_own_tx(room_name: &str, client_id: u64) -> Option<Tx> {
    RELAY
        .lock()
        .unwrap()
        .get(room_name)
        .and_then(|room| room.subs.get(&client_id).cloned())
}

/// 受信バイナリを処理し、(送信者への応答, 他者への転送先) を返す。
/// 転送するのは受信バイト列そのまま (Yjs メッセージは冪等)。
pub fn relay_handle(room_name: &str, client_id: u64, data: &[u8]) -> (Vec<Vec<u8>>, Vec<Tx>) {
    let mut rooms = RELAY.lock().unwrap();
    let room = rooms
        .entry(room_name.to_string())
        .or_insert_with(RelayRoom::new);
    let proto = DefaultProtocol;
    let replies: Vec<Vec<u8>> = match proto.handle(&mut room.awareness, data) {
        Ok(msgs) => msgs.iter().map(|m: &SyncMessage| m.encode_v1()).collect(),
        Err(e) => {
            log::warn!("relay protocol error: {}", e);
            Vec::new()
        }
    };
    let others: Vec<Tx> = room
        .subs
        .iter()
        .filter(|(id, _)| **id != client_id)
        .map(|(_, tx)| tx.clone())
        .collect();
    room.rx_messages += 1;
    // others への転送は呼び出し側が行う。ここでは応答分を計上する
    room.tx_messages += replies.len() as u64;
    (replies, others)
}

/// 転送カウンタを加算 (呼び出し側の素通し転送時に呼ぶ)
pub fn relay_count_forwarded(room_name: &str, n: u64) {
    if let Some(room) = RELAY.lock().unwrap().get_mut(room_name) {
        room.tx_messages += n;
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RelayStats {
    pub rx: u64,
    pub tx: u64,
    pub subs: usize,
}

pub fn relay_stats(room_name: &str) -> Option<RelayStats> {
    RELAY.lock().unwrap().get(room_name).map(|room| RelayStats {
        rx: room.rx_messages,
        tx: room.tx_messages,
        subs: room.subs.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::updates::decoder::{Decode, DecoderV1};
    use yrs::{GetString, ReadTxn, StateVector, Transact, Update};
    use yrs::Text as _Text;

    fn with_sync_header(inner: Vec<u8>) -> Vec<u8> {
        let mut out = vec![yrs::sync::protocol::MSG_SYNC];
        out.extend_from_slice(&inner);
        out
    }

    #[test]
    fn relay_converges_two_docs() {
        // クライアントA (yrs Doc) が更新を送り、サーバ経由でBに届くことを検証
        let room = "relay-test-room";
        let (tx_a, _rx_a) = mpsc::unbounded_channel::<Message>();
        let (tx_b, mut rx_b) = mpsc::unbounded_channel::<Message>();
        relay_subscribe(room, 1, tx_a);
        relay_subscribe(room, 2, tx_b);

        let doc_a = Doc::new();
        let txt_a = doc_a.get_or_insert_text("t");
        let sv_a = doc_a.transact().state_vector();

        // A: SyncStep1 → サーバは Step2 で応答するはず
        let step1 = with_sync_header(yrs::sync::SyncMessage::SyncStep1(sv_a).encode_v1());
        let (replies, others) = relay_handle(room, 1, &step1);
        assert!(!replies.is_empty(), "step1 には応答が必要");
        assert_eq!(others.len(), 1, "B へ転送される");

        // A がテキストを書いて Update を送信 (handle_client と同じく素通し配送)
        {
            let mut txn = doc_a.transact_mut();
            txt_a.push(&mut txn, "hello-relay");
        }
        let update = doc_a.transact().encode_state_as_update_v1(&StateVector::default());
        let msg = with_sync_header(yrs::sync::SyncMessage::Update(update).encode_v1());
        let (_replies2, others2) = relay_handle(room, 1, &msg);
        for tx in &others2 {
            tx.send(Message::Binary(msg.clone().into())).unwrap();
        }

        // B が受信バイトを適用し、内容が一致すること
        let received = rx_b.try_recv().expect("B は転送を受信する");
        let payload = match received {
            Message::Binary(b) => b.to_vec(),
            _ => panic!("binary expected"),
        };
        assert_eq!(&payload[1..], &msg[1..], "中継はバイト列を素通しする");
        let doc_b = Doc::new();
        {
            use yrs::encoding::read::Cursor;
            let mut decoder = DecoderV1::new(Cursor::new(&payload[1..]));
            let decoded = yrs::sync::SyncMessage::decode(&mut decoder).expect("decode");
            if let yrs::sync::SyncMessage::Update(bytes) = decoded {
                let update_b = Update::decode_v1(&bytes).expect("update decode");
                doc_b.transact_mut().apply_update(update_b);
            } else {
                panic!("update expected");
            }
        }
        let txt_b = doc_b.get_or_insert_text("t");
        assert_eq!(txt_b.get_string(&doc_b.transact()), "hello-relay");

        relay_unsubscribe(1);
        relay_unsubscribe(2);
    }
}
