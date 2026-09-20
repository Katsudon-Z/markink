#!/bin/bash
cd "$(dirname "$0")"
npm run dev -- --port 3000 --host 0.0.0.0
