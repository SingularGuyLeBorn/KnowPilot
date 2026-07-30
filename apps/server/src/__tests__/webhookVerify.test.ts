import { describe, expect, it } from "vitest";
import { sign } from "node:crypto";
import { createHash } from "node:crypto";
import {
  decryptFeishuEncryptPayload,
  gateFeishuVerificationToken,
  gateQqWebhook,
  prepareFeishuWebhookBody,
  qqEd25519PrivateKeyFromSecret,
  qqEd25519SeedFromSecret,
  signQqUrlValidation,
  verifyFeishuRequestSignature,
  verifyQqEventSignature,
} from "../infra/channels/webhookVerify.js";

describe("webhookVerify QQ Ed25519", () => {
  const secret = "test-bot-secret-abc";

  it("seed 重复截断为 32 字节", () => {
    const seed = qqEd25519SeedFromSecret("short");
    expect(seed.length).toBe(32);
  });

  it("op=13 challenge 返回可验的 signature", () => {
    const raw = JSON.stringify({
      op: 13,
      d: { plain_token: "Arq0D5A61EgUu4OxUvOp", event_ts: "1725442341" },
    });
    const gate = gateQqWebhook({
      botSecret: secret,
      body: JSON.parse(raw),
      rawBody: raw,
      signatureHex: undefined,
      timestamp: undefined,
    });
    expect(gate.kind).toBe("challenge");
    if (gate.kind !== "challenge") return;
    expect(gate.plain_token).toBe("Arq0D5A61EgUu4OxUvOp");
    expect(gate.signature).toMatch(/^[0-9a-f]{128}$/);
    const expected = signQqUrlValidation({
      botSecret: secret,
      eventTs: "1725442341",
      plainToken: "Arq0D5A61EgUu4OxUvOp",
    });
    expect(gate.signature).toBe(expected);
  });

  it("事件验签：自签自验通过，篡改失败", () => {
    const body = '{"op":0,"t":"C2C_MESSAGE_CREATE","d":{"content":"hi"}}';
    const ts = "1725442341";
    const msg = Buffer.concat([Buffer.from(ts, "utf8"), Buffer.from(body, "utf8")]);
    const sig = sign(null, msg, qqEd25519PrivateKeyFromSecret(secret)).toString("hex");
    expect(
      verifyQqEventSignature({
        botSecret: secret,
        signatureHex: sig,
        timestamp: ts,
        rawBody: body,
      }),
    ).toBe(true);
    expect(
      verifyQqEventSignature({
        botSecret: secret,
        signatureHex: sig,
        timestamp: ts,
        rawBody: body + "x",
      }),
    ).toBe(false);
    const gate = gateQqWebhook({
      botSecret: secret,
      body: JSON.parse(body),
      rawBody: body,
      signatureHex: sig,
      timestamp: ts,
    });
    expect(gate.kind).toBe("ok");
  });

  it("缺签名拒绝对事件", () => {
    const gate = gateQqWebhook({
      botSecret: secret,
      body: { op: 0 },
      rawBody: "{}",
      signatureHex: "",
      timestamp: "1",
    });
    expect(gate.kind).toBe("reject");
  });
});

describe("webhookVerify 飞书 token", () => {
  it("未配置硬拒", () => {
    const r = gateFeishuVerificationToken({ configuredToken: "", incomingToken: "x" });
    expect(r.ok).toBe(false);
  });

  it("匹配通过 / 不匹配拒", () => {
    expect(
      gateFeishuVerificationToken({ configuredToken: "tok", incomingToken: "tok" }).ok,
    ).toBe(true);
    expect(
      gateFeishuVerificationToken({ configuredToken: "tok", incomingToken: "bad" }).ok,
    ).toBe(false);
  });
});

describe("webhookVerify 飞书 Encrypt Key", () => {
  it("官方样例 decrypt → hello world", () => {
    expect(
      decryptFeishuEncryptPayload("test key", "P37w+VZImNgPEO1RBhJ6RtKl7n6zymIbEG1pReEzghk="),
    ).toBe("hello world");
  });

  it("配了 Encrypt Key 时验签失败拒", () => {
    const body = { encrypt: "P37w+VZImNgPEO1RBhJ6RtKl7n6zymIbEG1pReEzghk=" };
    const raw = JSON.stringify(body);
    const r = prepareFeishuWebhookBody({
      encryptKey: "test key",
      body,
      rawBody: raw,
      timestamp: "1",
      nonce: "n",
      signature: "deadbeef",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("验签通过后解密 JSON body", () => {
    // 用官方样例明文 hello world（非 JSON）验证 decrypt；JSON 事件用自签名明文路径
    const plainObj = { type: "url_verification", challenge: "c-ok", token: "tok" };
    // 自签：无 encrypt 字段时只验签，body 原样返回
    const raw = JSON.stringify(plainObj);
    const ts = "1725442341";
    const nonce = "nonce1";
    const key = "test key";
    const sig = createHash("sha256").update(ts + nonce + key + raw, "utf8").digest("hex");
    expect(
      verifyFeishuRequestSignature({
        encryptKey: key,
        timestamp: ts,
        nonce,
        rawBody: raw,
        signature: sig,
      }),
    ).toBe(true);
    const r = prepareFeishuWebhookBody({
      encryptKey: key,
      body: plainObj,
      rawBody: raw,
      timestamp: ts,
      nonce,
      signature: sig,
    });
    expect(r).toEqual({ ok: true, body: plainObj });
  });

  it("未配 Encrypt Key 但收到 encrypt 硬拒", () => {
    const r = prepareFeishuWebhookBody({
      encryptKey: "",
      body: { encrypt: "P37w+VZImNgPEO1RBhJ6RtKl7n6zymIbEG1pReEzghk=" },
      rawBody: "{}",
      timestamp: "1",
      nonce: "n",
      signature: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });
});
