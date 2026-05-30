import assert from "node:assert/strict";

import { redactText } from "../../lib/redaction";

export const tests = [
  {
    name: "redacts /home/<user> path to ~",
    run() {
      const { text } = redactText("model at /home/alice/.cache/hf");
      assert.equal(text.includes("/home/alice"), false);
      assert.match(text, /~\/\.cache\/hf/);
    },
  },
  {
    name: "redacts /Users/<user> path to ~",
    run() {
      const { text } = redactText("model at /Users/alice/.cache/hf");
      assert.equal(text.includes("/Users/alice"), false);
      assert.match(text, /~\/\.cache\/hf/);
    },
  },
  {
    name: "redacts /root/ path to ~",
    run() {
      const { text } = redactText("model at /root/.cache/huggingface/qwen");
      assert.equal(text.includes("/root/"), false);
      assert.match(text, /~\/\.cache\/huggingface\/qwen/);
    },
  },
  {
    name: "redacts Windows C:\\Users\\<user> path",
    run() {
      const { text } = redactText("model at C:\\Users\\alice\\.cache\\hf");
      assert.equal(text.includes("C:\\Users\\alice"), false);
      assert.match(text, /model at ~\\\.cache\\hf/);
    },
  },
  {
    name: "redacts HF token in env-style line",
    run() {
      const { text } = redactText("HF_TOKEN=hf_abcdefghijklmnopqrstuv12345");
      assert.equal(text.includes("hf_abcdefghijklmnopqrstuv12345"), false);
      assert.match(text, /HF_TOKEN=<redacted>/);
    },
  },
  {
    name: "redacts sk- API key",
    run() {
      const { text } = redactText("Bearer sk-1234567890abcdefghijklmnopqrstuvwx");
      assert.equal(text.includes("sk-1234567890"), false);
      assert.match(text, /Bearer <api_key>/);
    },
  },
  {
    name: "redacts IP addresses",
    run() {
      const { text } = redactText("endpoint http://192.168.1.100:8001");
      assert.equal(text.includes("192.168.1.100"), false);
      assert.match(text, /endpoint http:\/\/<ip_address>:8001/);
    },
  },
  {
    name: "leaves benign paths alone",
    run() {
      const { text } = redactText("config at ./benchmarks/output.json");
      assert.match(text, /\.\/benchmarks\/output\.json/);
    },
  },
  {
    name: "redacts bare /root followed by whitespace",
    run() {
      const { text } = redactText("path=/root and continue");
      assert.equal(text.includes("/root"), false, "bare /root before space should be redacted, got: " + text);
    },
  },
  {
    name: "redacts /srv/<name> path to ~",
    run() {
      const { text } = redactText("data at /srv/somepath/file.json");
      assert.equal(text.includes("/srv/somepath"), false);
      assert.match(text, /~\/file\.json/);
    },
  },
  {
    name: "redacts /opt/<name> path to ~",
    run() {
      const { text } = redactText("install at /opt/vllm/runtime/log");
      assert.equal(text.includes("/opt/vllm"), false);
      assert.match(text, /~\/runtime\/log/);
    },
  },
  {
    name: "redactPathIfNeeded actually redacts /root model paths (M5)",
    run() {
      const { text } = redactText("/root/.cache/huggingface/hub/qwen3.6-35b");
      assert.equal(
        text.includes("/root/"),
        false,
        "Expected /root to be redacted but got: " + text,
      );
    },
  },
  {
    name: "prompt_source-style strings get path-redacted (H9)",
    run() {
      const { text } = redactText(
        "sharegpt(seed=42, file=/home/alice/.cache/benchtrace/sharegpt.json)",
      );
      assert.equal(text.includes("/home/alice"), false);
      assert.match(text, /file=~\/\.cache\/benchtrace\/sharegpt\.json/);
    },
  },
];
