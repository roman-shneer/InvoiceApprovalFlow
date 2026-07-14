#!/bin/bash


echo "🚀 Starting Ollama server in background..."
ollama serve > /dev/null 2>&1 &


echo "⏳ Waiting 5 seconds for Ollama initialization..."
sleep 5

if ! ollama list | grep -q "qwen2.5-coder:1.5b"; then
    echo "Model qwen2.5-coder:1.5b not found. Starting download (this will happen only once)..."
    ollama pull qwen2.5-coder:1.5b
else
    echo "Model qwen2.5-coder:1.5b already downloaded, skipping."
fi

echo "🔥 Starting python worker..."
exec python3 -u main.py