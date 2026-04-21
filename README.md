# CipherPad

[中文说明](README.zh-CN.md)

**Transparent encryption editor for VS Code — edit plaintext, save ciphertext.**

CipherPad lets you edit `.ctxt` files as if they were plain text files, while automatically encrypting everything on disk using AES-256-CBC. Your passwords never leave memory.

---

## Features

- 🔐 **Transparent encryption** — edit in plaintext, save as ciphertext
- 🔑 **AES-256-CBC + PBKDF2** — industry-standard encryption with 100,000 iterations
- 📜 **History snapshots** — last 3 versions preserved, restore anytime
- 🗂 **Multi-file support** — each `.ctxt` file has an independent password
- 🧩 **openssl compatible** — decrypt without VS Code if needed
- 🌓 **Theme-aware** — adapts to your VS Code dark/light theme

---

## Screenshots

> *(Screenshot placeholder — dark theme editor)*

![CipherPad Editor Dark](https://raw.githubusercontent.com/stvenx/cipherpad/main/docs/screenshot-dark.png)

> *(Screenshot placeholder — password prompt)*

![Password Prompt](https://raw.githubusercontent.com/stvenx/cipherpad/main/docs/screenshot-prompt.png)

---

## Getting Started

### Installation

**Option A — VS Code Marketplace:**
1. Open VS Code
2. Press `Ctrl+P` and run: `ext install stvenx.cipherpad`

**Option B — Manual VSIX:**
1. Download the `.vsix` file from [GitHub Releases](https://github.com/stvenx/cipherpad/releases)
2. In VS Code: `Extensions` → `...` menu → `Install from VSIX...`

---

## Usage

### Creating a new encrypted file
1. Create a file with the `.ctxt` extension (e.g., `secrets.ctxt`)
2. VS Code opens CipherPad automatically
3. Enter and confirm a new password
4. Start typing — press `Ctrl+S` / `Cmd+S` to save (encrypted to disk)

### Opening an existing `.ctxt` file
1. Open a `.ctxt` file in VS Code
2. Enter the password when prompted
3. The file is decrypted in memory — you see plaintext in the editor
4. Edit freely, save with `Ctrl+S` / `Cmd+S`

### Commands (Command Palette: `Ctrl+Shift+P`)

| Command | Description |
|---|---|
| `CipherPad: Change Password` | Re-encrypt the current file with a new password |
| `CipherPad: Show History` | View all saved snapshots with timestamps |
| `CipherPad: Restore from History` | Restore a previous snapshot as the current version |
| `CipherPad: Export Plaintext` | Export decrypted content to a temporary `.txt` file |

---

## Decrypting Without VS Code

CipherPad uses AES-256-CBC with an **explicit random IV** and PBKDF2 key derivation.
Because the IV is stored separately in the file (not derived from the password), you need
a two-step process: first derive the key from the password+salt, then pass the key and IV
explicitly to `openssl enc -K/-iv`.

### Full decryption script (Python + openssl)

```python
#!/usr/bin/env python3
"""
decrypt_ctxt.py — Decrypt a CipherPad .ctxt file
Usage: python3 decrypt_ctxt.py secrets.ctxt
"""
import json, sys, base64, hashlib, subprocess, getpass

def main():
    file_path = sys.argv[1] if len(sys.argv) > 1 else input("Path to .ctxt file: ")
    password  = getpass.getpass("Password: ")

    with open(file_path) as f:
        data = json.load(f)

    latest = data["history"][0]
    salt_b = base64.b64decode(latest["salt"])
    iv_b   = base64.b64decode(latest["iv"])
    cipher = latest["ciphertext"]

    # Derive 256-bit key with PBKDF2-SHA256 (100000 iterations)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt_b, 100000, dklen=32)

    key_hex = key.hex()
    iv_hex  = iv_b.hex()

    # Pipe ciphertext through openssl
    result = subprocess.run(
        ["openssl", "enc", "-d", "-aes-256-cbc",
         "-K", key_hex, "-iv", iv_hex, "-base64"],
        input=cipher.encode(),
        capture_output=True
    )

    if result.returncode != 0:
        print("Decryption failed:", result.stderr.decode(), file=sys.stderr)
        sys.exit(1)

    print(result.stdout.decode(), end="")

if __name__ == "__main__":
    main()
```

### Quick one-liner (bash — requires Python 3)
```bash
PASSWORD="your_password"
FILE="secrets.ctxt"

python3 -c "
import json, base64, hashlib
data = json.load(open('$FILE'))
h = data['history'][0]
key = hashlib.pbkdf2_hmac('sha256', b'$PASSWORD', base64.b64decode(h['salt']), 100000, 32)
print(key.hex(), base64.b64decode(h['iv']).hex(), h['ciphertext'])
" | read KEY IV CIPHER && echo "\$CIPHER" | openssl enc -d -aes-256-cbc -K "\$KEY" -iv "\$IV" -base64
```

### Why not `openssl enc -pbkdf2 -pass pass:...` directly?

`openssl enc -pbkdf2` derives **both the key AND the IV** from the password in one step,
discarding any explicit IV. CipherPad intentionally generates a **cryptographically random
IV per save** (stronger security — prevents ciphertext comparison attacks across saves),
which requires the explicit `-K key_hex -iv iv_hex` form of `openssl enc`.
The security properties are equivalent; the decryption is just a two-step process.

---

## File Format

`.ctxt` files are stored as JSON on disk:

```json
{
  "version": 1,
  "algorithm": "aes-256-cbc",
  "kdf": "pbkdf2",
  "iterations": 100000,
  "history": [
    {
      "salt": "<base64-encoded salt>",
      "iv": "<base64-encoded IV>",
      "ciphertext": "<base64-encoded ciphertext>",
      "savedAt": "2024-01-15T10:30:00.000Z",
      "hint": ""
    },
    {
      "salt": "...",
      "iv": "...",
      "ciphertext": "...",
      "savedAt": "2024-01-14T09:00:00.000Z",
      "hint": ""
    }
  ]
}
```

- `history[0]` is always the **most recent** version
- Up to **3 snapshots** are kept (oldest are discarded)
- Each snapshot uses an **independently generated** salt and IV
- The password is **never stored** in the file

---

## Security Notes

- AES-256-CBC with random IV per save (prevents ciphertext comparison attacks)
- PBKDF2-SHA256 with 100,000 iterations (slows down brute-force)
- Passwords are stored **in memory only** — cleared on file close and extension deactivation
- History snapshots are re-encrypted if you change the password

---

## Requirements

- VS Code 1.85.0 or later
- No external npm dependencies — uses Node.js built-in `crypto` module

---

## License

MIT
