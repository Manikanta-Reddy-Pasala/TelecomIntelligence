#!/bin/bash
# TIAC Model Training Script
# This creates a fine-tuned Ollama model from the training dataset
#
# The approach: We use Ollama's Modelfile with a comprehensive system prompt
# that includes all training examples as few-shot context. This is the most
# practical approach for Ollama (vs full LoRA fine-tuning which needs GPU + Unsloth).
#
# For production: Use Unsloth + QLoRA on a GPU machine for true fine-tuning.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRAINING_DATA="$SCRIPT_DIR/training/dataset.jsonl"
MODELFILE="$SCRIPT_DIR/Modelfile"

echo "=== TIAC Model Training ==="
echo "Training data: $TRAINING_DATA"
echo "Model file: $MODELFILE"

# Check if running inside Docker or on host
if command -v ollama &> /dev/null; then
    OLLAMA_CMD="ollama"
elif docker ps --filter name=tiac_ollama --format '{{.Names}}' | grep -q tiac_ollama; then
    OLLAMA_CMD="docker exec tiac_ollama ollama"
else
    echo "ERROR: Neither ollama CLI nor tiac_ollama container found"
    exit 1
fi

# Pull base model if not exists
echo "Ensuring base model exists..."
$OLLAMA_CMD pull tinyllama 2>/dev/null || true

# Build model
echo "Building tiac-analyst model..."
if [ "$OLLAMA_CMD" = "ollama" ]; then
    ollama create tiac-analyst -f "$MODELFILE"
else
    docker cp "$MODELFILE" tiac_ollama:/tmp/Modelfile
    docker exec tiac_ollama ollama create tiac-analyst -f /tmp/Modelfile
fi

echo ""
echo "=== Model created: tiac-analyst ==="
echo ""
echo "Test it:"
echo '  ollama run tiac-analyst "Query: Analyze +919876543210\nFacts: 45 calls, 3 anomalies detected\nResponse:"'
echo ""
echo "For production fine-tuning with LoRA (requires GPU):"
echo "  1. Install unsloth: pip install unsloth"
echo "  2. Run: python training/finetune.py"
echo "  3. Convert to GGUF: python -m unsloth.save --model ./output --type gguf"
echo "  4. Create Ollama model: ollama create tiac-analyst-ft -f Modelfile.finetuned"
