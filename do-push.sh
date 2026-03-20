#!/bin/bash
# Push backend changes
cd "c:/Users/DELL/Desktop/gestor-trafego-backend"
git add vercel.json
git commit -m "fix: maxDuration 60s no Vercel para Whisper+GPT+TTS

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin master

# Push frontend changes
cd "c:/Users/DELL/Desktop/gestor-trafego-front"
git add src/App.jsx
git commit -m "fix: voz em 3 requests separados (transcribe+chat+TTS) evita timeout Vercel

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin master

echo "Done!"
