"""Read-only verification of the two exact 0.000002 mainnet admin batches.

Runs with Python 3 stdlib and public RPCs, including on a remote host if local
RPC connectivity is interrupted. Pass the project root or a directory containing
config/networks.json, limits-plan.json, and amount-limit-preflight-20260927.json.
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
networks = json.loads((root / "config/networks.json").read_text())
project_layout = (root / "web/immediate-deploy/limits-plan.json").exists()
plan_path = root / ("web/immediate-deploy/limits-plan.json" if project_layout else "limits-plan.json")
preflight_path = root / ("research/production/immediate-beta-mainnet/amount-limit-preflight-20260927.json" if project_layout else "amount-limit-preflight-20260927.json")
plan = json.loads(plan_path.read_text())
preflight = json.loads(preflight_path.read_text())
hash_hints = {"bsc": sys.argv[2]} if len(sys.argv) > 2 else {}
topic = "0xd56a081faf69b7384c1c2232dc98a14cf3490c2b0f15a2b9c60558972208fc6f"
selectors = {"owner": "0x8da5cb5b", "guardian": "0x452a9320", "peers": "0xbb0b6a53", "outbound": "0x5109932e", "inbound": "0x4a026227", "depositsPaused": "0x60da3e83", "sendsPaused": "0x4bcd2f78", "receivesPaused": "0xc28c6cb7"}


def rpc(url, method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, body, {"Content-Type": "application/json", "User-Agent": "curl/8.0"})
            with urllib.request.urlopen(request, timeout=35) as response:
                result = json.load(response)
            if "error" in result:
                raise RuntimeError(f"{method}: {result['error'].get('message', 'RPC error')[:100]}")
            return result["result"]
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def require(condition, label):
    if not condition:
        raise AssertionError(label)


def words(data):
    raw = data[2:]
    require(len(raw) % 64 == 0, "malformed return data")
    return [int(raw[offset:offset + 64], 16) for offset in range(0, len(raw), 64)]


def call(url, address, data, block):
    return rpc(url, "eth_call", [{"to": address, "data": data}, hex(block)])


report = {
    "checkedAt": datetime.now(timezone.utc).isoformat(),
    "status": "MAINNET_LIMIT_UPDATE_VERIFIED",
    "releaseId": plan["releaseId"],
    "chains": {},
    "limitations": ["No 0.000002 asset transfer was sent by this verification.", "This verifies exact configuration receipts and current contract state, not future bridge delivery."],
}
for batch in plan["batches"]:
    side = batch["side"]
    network = networks[side]
    url = "https://bsc-dataseed.bnbchain.org" if side == "bsc" else network["rpc"]
    require(int(rpc(url, "eth_chainId", []), 16) == batch["chainId"], f"{side}: wrong network")
    head = int(rpc(url, "eth_blockNumber", []), 16)
    floor = preflight["chains"][side]["block"]
    require(head >= floor, f"{side}: head before preflight")
    if side in hash_hints:
        tx_hash = hash_hints[side]
    else:
        found = {}
        for end in range(head, floor - 1, -500):
            start = max(floor, end - 499)
            logs = rpc(url, "eth_getLogs", [{"fromBlock": hex(start), "toBlock": hex(end), "address": list(set(batch["targets"])), "topics": [topic]}])
            for log in logs:
                values = words(log["data"])
                if values != [values[0], 2, 10, 100] or values[0] not in (0, 1):
                    continue
                for index, target in enumerate(batch["targets"]):
                    if target.lower() == log["address"].lower() and index % 2 == values[0]:
                        found.setdefault(index, log["transactionHash"])
            if len(found) == 4:
                break
        require(len(found) == 4, f"{side}: four limit events not found")
        hashes = set(found.values())
        require(len(hashes) == 1, f"{side}: limits were not one batch")
        tx_hash = hashes.pop()
    tx = rpc(url, "eth_getTransactionByHash", [tx_hash])
    receipt = rpc(url, "eth_getTransactionReceipt", [tx_hash])
    require(tx and receipt and int(receipt["status"], 16) == 1, f"{side}: batch receipt failed")
    require(tx["from"].lower() == plan["account"].lower() and tx["to"].lower() == batch["admin"].lower(), f"{side}: sender/admin mismatch")
    require(tx["input"].lower() == batch["transaction"]["data"].lower(), f"{side}: calldata differs from reviewed batch")
    require(sum(1 for log in receipt["logs"] if log["topics"][0].lower() == topic and log["address"].lower() in [target.lower() for target in batch["targets"]]) == 4, f"{side}: receipt event count")
    require(rpc(url, "eth_getCode", [batch["admin"], hex(head)]) != "0x", f"{side}: no admin code")
    require(hex(words(call(url, batch["admin"], selectors["owner"], head))[0])[-40:] == plan["account"].lower()[-40:], f"{side}: admin owner changed")
    other = "arc" if side == "bsc" else "bsc"
    other_batch = next(item for item in plan["batches"] if item["side"] == other)
    rows = []
    for index, asset in ((0, "binancelife"), (2, "cat")):
        address = batch["targets"][index]
        require(rpc(url, "eth_getCode", [address, hex(head)]) != "0x", f"{side}/{asset}: no app code")
        owner = words(call(url, address, selectors["owner"], head))[0]
        guardian = words(call(url, address, selectors["guardian"], head))[0]
        peer = words(call(url, address, selectors["peers"] + format(networks[other]["eid"], "064x"), head))[0]
        outbound = words(call(url, address, selectors["outbound"], head))
        inbound = words(call(url, address, selectors["inbound"], head))
        send_selector = selectors["depositsPaused"] if side == "bsc" else selectors["sendsPaused"]
        send_paused = words(call(url, address, send_selector, head))[0] != 0
        receive_paused = words(call(url, address, selectors["receivesPaused"], head))[0] != 0
        require(owner == int(batch["admin"], 16) and guardian == int(plan["account"], 16), f"{side}/{asset}: ownership changed")
        require(peer == int(other_batch["targets"][index], 16), f"{side}/{asset}: peer changed")
        require(outbound[:3] == [2, 10, 100] and inbound[:3] == [2, 10, 100] and outbound[5] == 1 and inbound[5] == 1, f"{side}/{asset}: unexpected limits")
        require(not send_paused and not receive_paused, f"{side}/{asset}: paused")
        rows.append({"asset": asset, "app": address, "outboundSingleSD": 2, "inboundSingleSD": 2, "burstSD": 10, "windowCapSD": 100, "sendPaused": send_paused, "receivePaused": receive_paused})
    report["chains"][side] = {"chainId": batch["chainId"], "verifiedAtBlock": head, "transactionHash": tx_hash, "transactionBlock": int(receipt["blockNumber"], 16), "transactionStatus": 1, "from": tx["from"], "to": tx["to"], "gasUsed": str(int(receipt["gasUsed"], 16)), "rows": rows}

result = root / ("research/production/immediate-beta-mainnet/amount-limit-verification-20260927.json" if project_layout else "amount-limit-verification-20260927.json")
result.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": report["status"], "path": str(result), "chains": {side: {"transactionHash": chain["transactionHash"], "verifiedAtBlock": chain["verifiedAtBlock"]} for side, chain in report["chains"].items()}}))
