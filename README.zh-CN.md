# CipherPad

[English](README.md)

**VS Code 透明加密编辑器 — 看到明文，存储密文。**

CipherPad 让你像编辑普通文本文件一样编辑 `.ctxt` 文件，同时自动以 AES-256-CBC 加密所有内容写入磁盘。密码只保存在内存中，永不落盘。

---

## 功能特性

- 🔐 **透明加密** — 以明文编辑，以密文保存
- 🔑 **AES-256-CBC + PBKDF2** — 行业标准加密，10 万次迭代
- 📜 **历史快照** — 保留最近 3 个版本，随时恢复
- 🗂 **多文件支持** — 每个 `.ctxt` 文件独立密码
- 🧩 **兼容 openssl** — 无需 VS Code 也可解密
- 🌓 **主题适配** — 自动适配深色/浅色主题

---

## 使用方法

### 安装

**方式 A — VS Code 插件市场：**
1. 打开 VS Code
2. 按 `Ctrl+P`，输入：`ext install stvenx.cipherpad`

**方式 B — 手动安装 VSIX：**
1. 从 [GitHub Releases](https://github.com/stvenx/cipherpad/releases) 下载 `.vsix` 文件
2. 在 VS Code 中：`扩展` → `...` 菜单 → `从 VSIX 安装...`

---

### 新建加密文件
1. 创建 `.ctxt` 后缀的文件（如 `secrets.ctxt`）
2. VS Code 自动打开 CipherPad 编辑器
3. 输入并确认密码
4. 开始输入内容，按 `Ctrl+S` / `Cmd+S` 保存（自动加密写盘）

### 打开已有 `.ctxt` 文件
1. 在 VS Code 中打开 `.ctxt` 文件
2. 输入密码
3. 文件在内存中解密，编辑器显示明文
4. 自由编辑，`Ctrl+S` / `Cmd+S` 保存

### 命令（命令面板：`Ctrl+Shift+P`）

| 命令 | 说明 |
|---|---|
| `CipherPad: Change Password` | 用新密码重新加密当前文件 |
| `CipherPad: Show History` | 查看所有历史快照及时间戳 |
| `CipherPad: Restore from History` | 将历史快照恢复为当前版本 |
| `CipherPad: Export Plaintext` | 导出解密内容到临时 `.txt` 文件 |

---

## 用 openssl 解密（无需 VS Code）

CipherPad 使用独立随机 IV（而非从密码派生），因此需要先用 Python 推导密钥，再传给 openssl：

```python
#!/usr/bin/env python3
# 用法: python3 decrypt_ctxt.py secrets.ctxt
import json, sys, base64, hashlib, subprocess, getpass

file_path = sys.argv[1]
password  = getpass.getpass("密码: ")

data   = json.load(open(file_path))
latest = data["history"][0]
salt_b = base64.b64decode(latest["salt"])
iv_b   = base64.b64decode(latest["iv"])
cipher = latest["ciphertext"]

key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt_b, 100000, dklen=32)

result = subprocess.run(
    ["openssl", "enc", "-d", "-aes-256-cbc",
     "-K", key.hex(), "-iv", iv_b.hex(), "-base64"],
    input=cipher.encode(), capture_output=True
)
print(result.stdout.decode(), end="")
```

---

## 文件格式

`.ctxt` 文件以 JSON 格式存储在磁盘上：

```json
{
  "version": 1,
  "algorithm": "aes-256-cbc",
  "kdf": "pbkdf2",
  "iterations": 100000,
  "history": [
    {
      "salt": "<base64 编码的盐值>",
      "iv": "<base64 编码的 IV>",
      "ciphertext": "<base64 编码的密文>",
      "savedAt": "2024-01-15T10:30:00.000Z",
      "hint": ""
    }
  ]
}
```

- `history[0]` 始终是**最新版本**
- 最多保留 **3 个快照**（超出自动丢弃最旧的）
- 每个快照使用**独立生成的**盐值和 IV
- 密码**不会存储**在文件中

---

## 安全说明

- 每次保存生成独立随机 IV，防止密文比对攻击
- PBKDF2-SHA256 10 万次迭代，减慢暴力破解
- 密码仅保存在内存，关闭文件自动清除
- 修改密码时，所有历史快照同步重新加密

---

## 系统要求

- VS Code 1.85.0 及以上
- 无外部 npm 依赖，使用 Node.js 内置 `crypto` 模块

---

## License

MIT
