#!/usr/bin/env python3
"""Manage Costing site logins in costing/keys.json (role: sales or manager).

  DATA_KEY=... python3 scripts/cost_users.py add <username> <password> [sales|manager]
  python3 scripts/cost_users.py remove <username>
  python3 scripts/cost_users.py list
"""
import base64, hashlib, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "costing", "keys.json")
ITER = 310000
uid = lambda u: hashlib.sha256(("almentor-cost:" + u.strip().lower()).encode()).hexdigest()
def load():
    try: return json.load(open(PATH))
    except FileNotFoundError: return {"v": 1, "users": {}}
def save(d):
    os.makedirs(os.path.dirname(PATH), exist_ok=True); json.dump(d, open(PATH, "w"), indent=1)
def cost_key():
    from sync import load_enc, key
    return base64.b64decode(load_enc(os.path.join(ROOT, "data", "cost", "key.enc"), key(), None)["key"])
def add(u, p, role="sales"):
    k = cost_key(); salt = os.urandom(16); iv = os.urandom(12)
    kek = hashlib.pbkdf2_hmac("sha256", p.encode(), salt, ITER, 32)
    d = load(); d["users"][uid(u)] = {"salt": base64.b64encode(salt).decode(), "iter": ITER, "iv": base64.b64encode(iv).decode(),
                                      "wk": base64.b64encode(AESGCM(kek).encrypt(iv, k, None)).decode(), "role": role}
    save(d)
if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    if cmd == "add": add(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "sales"); print("added", sys.argv[2])
    elif cmd == "remove": d = load(); d["users"].pop(uid(sys.argv[2]), None); save(d); print("removed", sys.argv[2])
    else: print(len(load()["users"]), "logins")
