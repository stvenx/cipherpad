# Changelog

All notable changes to CipherPad will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-20

### Added
- Initial release
- AES-256-CBC encryption with PBKDF2 key derivation (100,000 iterations)
- Custom WebView editor for `.ctxt` files
- Password prompt on file open; new password setup for new files
- In-memory password management (per-file, cleared on close)
- History snapshots: last 3 versions preserved per file
- `CipherPad: Change Password` command — re-encrypts all history with new password
- `CipherPad: Show History` command — view all snapshots with timestamps
- `CipherPad: Restore from History` command — restore any snapshot as current
- `CipherPad: Export Plaintext` command — export decrypted content to temp file
- openssl-compatible file format
- VS Code theme-aware editor UI (dark/light)
- Ctrl+S / Cmd+S keyboard shortcut for saving
- Status bar showing char count, last saved time, and algorithm
