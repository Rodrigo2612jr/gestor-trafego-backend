@echo off
cd /d "C:\Users\DELL\Desktop\gestor-trafego-backend"
git add vercel.json
git commit -m "fix: maxDuration 60s no Vercel para Whisper+GPT+TTS"
git push origin master

cd /d "C:\Users\DELL\Desktop\gestor-trafego-front"
git add src\App.jsx
git commit -m "fix: voz em 3 requests separados (transcribe+chat+TTS) evita timeout Vercel"
git push origin master

echo.
echo === PUSH CONCLUIDO ===
pause
