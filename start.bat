@echo off
rem Speaking Coach ローカルサーバ起動
rem PWA（Service Worker）は file:// では動かないため localhost で配信する
cd /d %~dp0
start "" http://localhost:8765
python -m http.server 8765
