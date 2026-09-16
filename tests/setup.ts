// テスト共通セットアップ: jsdom に不足している DOM 幾何 API を補う
// (ProseMirror の scrollIntoView / coordsAtPos が getClientRects を要求するため)

const emptyRectList = () =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: [][Symbol.iterator]
  }) as unknown as DOMRectList;

const zeroRect = () =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({})
  }) as DOMRect;

if (typeof Element !== 'undefined') {
  if (typeof Element.prototype.getClientRects !== 'function') {
    Element.prototype.getClientRects = emptyRectList;
  }
  if (typeof Element.prototype.getBoundingClientRect !== 'function') {
    Element.prototype.getBoundingClientRect = zeroRect;
  }
  if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = emptyRectList;
    Range.prototype.getBoundingClientRect = zeroRect;
  }
}
