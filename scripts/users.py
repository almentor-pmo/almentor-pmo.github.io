#!/usr/bin/env python3
"""Manage dashboard logins in keys.json.

Each login wraps the dashboard's DATA_KEY with a key derived from the
username + password (PBKDF2-SHA256), so keys.json can be public: without a
valid username and password it is useless.

  DATA_KEY=... python3 scripts/users.py add <username> <password>
  python3 scripts/users.py remove <username>
  python3 scripts/users.py list
"""
import base64, hashlib, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "keys.json")
ITER = 310000


def uid(username):
    return hashlib.sha256(("almentor-pmo:" + username.strip().lower()).encode()).hexdigest()


def load():
    try:
        return json.load(open(PATH))
    except FileNotFoundError:
        return {"v": 1, "users": {}}


def save(d):
    json.dump(d, open(PATH, "w"), indent=1)


def add(username, password):
    k = base64.b64decode(os.environ["DATA_KEY"])
    salt = os.urandom(16)
    kek = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITER, 32)
    iv = os.urandom(12)
    wrapped = AESGCM(kek).encrypt(iv, k, None)
    d = load()
    d["users"][uid(username)] = {"salt": base64.b64encode(salt).decode(),
                                 "iter": ITER, "iv": base64.b64encode(iv).decode(),
                                 "wk": base64.b64encode(wrapped).decode()}
    save(d)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    if cmd == "add":
        add(sys.argv[2], sys.argv[3]); print("added", sys.argv[2])
    elif cmd == "remove":
        d = load(); d["users"].pop(uid(sys.argv[2]), None); save(d); print("removed", sys.argv[2])
    else:
        print(len(load()["users"]), "logins")
