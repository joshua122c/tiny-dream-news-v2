@echo off
setlocal
cd /d "C:\Users\Fung\Documents\Codex\2026-06-19\joshua122c-tiny-dream-news-v2-https"
echo Tiny Dream News V2 preview server
echo.
echo Keep this window open while previewing.
echo URL: http://127.0.0.1:4321/
echo.
start "" "http://127.0.0.1:4321/"
"C:\Users\Fung\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 4321 --bind 127.0.0.1 --directory "C:\Users\Fung\Documents\Codex\2026-06-19\joshua122c-tiny-dream-news-v2-https\dist"
pause
