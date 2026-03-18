"""
TIAC Model Fine-Tuning with Unsloth + QLoRA
============================================
Requires: GPU with 8GB+ VRAM, CUDA 11.8+

Install:
    pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
    pip install --no-deps trl peft accelerate bitsandbytes

Usage:
    python finetune.py

This creates a QLoRA fine-tuned model from the training dataset.
After training, export to GGUF for use with Ollama.
"""

import json
import os

# Check if unsloth is available
try:
    from unsloth import FastLanguageModel
    from trl import SFTTrainer
    from transformers import TrainingArguments
    from datasets import Dataset
    HAS_UNSLOTH = True
except ImportError:
    HAS_UNSLOTH = False
    print("Unsloth not installed. Install with:")
    print('  pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"')
    print('  pip install --no-deps trl peft accelerate bitsandbytes')
    print()


# Training configuration
BASE_MODEL = "unsloth/tinyllama-chat-bnb-4bit"  # 4-bit quantized for memory efficiency
MAX_SEQ_LENGTH = 2048
LORA_R = 16
LORA_ALPHA = 16
LORA_DROPOUT = 0.0
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
DATASET_FILE = os.path.join(os.path.dirname(__file__), "dataset.jsonl")

# Prompt template matching our Modelfile
PROMPT_TEMPLATE = """<|system|>
You are TIAC, a senior telecom intelligence analyst assistant. Analyze CDR data, location patterns, and communication networks. Be concise, factual, and flag suspicious activity with severity levels.</s>
<|user|>
{prompt}</s>
<|assistant|>
{response}</s>"""


def load_dataset():
    """Load training data from JSONL file."""
    examples = []
    with open(DATASET_FILE, "r") as f:
        for line in f:
            if line.strip():
                data = json.loads(line)
                examples.append({
                    "text": PROMPT_TEMPLATE.format(
                        prompt=data["prompt"],
                        response=data["response"]
                    )
                })
    print(f"Loaded {len(examples)} training examples")
    return Dataset.from_list(examples)


def train():
    """Fine-tune the model with QLoRA."""
    if not HAS_UNSLOTH:
        print("Cannot train without unsloth. See install instructions above.")
        return

    print(f"Loading base model: {BASE_MODEL}")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=BASE_MODEL,
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,  # Auto-detect
        load_in_4bit=True,
    )

    # Add LoRA adapters
    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_R,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        bias="none",
        use_gradient_checkpointing="unsloth",
    )

    # Load dataset
    dataset = load_dataset()

    # Training arguments
    training_args = TrainingArguments(
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        warmup_steps=5,
        max_steps=60,  # Small dataset, few steps needed
        learning_rate=2e-4,
        fp16=True,
        logging_steps=1,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="linear",
        output_dir=OUTPUT_DIR,
        save_strategy="steps",
        save_steps=30,
    )

    # Trainer
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LENGTH,
        args=training_args,
    )

    print("Starting fine-tuning...")
    trainer.train()

    # Save model
    print(f"Saving model to {OUTPUT_DIR}")
    model.save_pretrained(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)

    # Export to GGUF for Ollama
    gguf_path = os.path.join(OUTPUT_DIR, "tiac-analyst.gguf")
    print(f"Exporting to GGUF: {gguf_path}")
    model.save_pretrained_gguf(OUTPUT_DIR, tokenizer, quantization_method="q4_k_m")

    print()
    print("=" * 60)
    print("Fine-tuning complete!")
    print(f"GGUF model saved to: {OUTPUT_DIR}")
    print()
    print("To use with Ollama:")
    print(f"  1. Copy {gguf_path} to your Ollama server")
    print("  2. Create Modelfile.finetuned with:")
    print(f'     FROM {gguf_path}')
    print("  3. ollama create tiac-analyst-ft -f Modelfile.finetuned")
    print("=" * 60)


if __name__ == "__main__":
    train()
