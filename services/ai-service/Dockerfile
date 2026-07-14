FROM ollama/ollama:latest


RUN apt-get update && apt-get install -y curl python3 python3-pip python3-venv && \
    apt-get clean && rm -rf /var/lib/apt/lists/*


WORKDIR /app
COPY requirements.txt .
COPY entrypoint.sh .
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages

COPY . .
RUN sed -i 's/\r$//' /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
