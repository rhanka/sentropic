#!/usr/bin/env bash
set -euo pipefail
cache=$1
manifest=scripts/decision/kev-manifest.json
mkdir -p "$cache"
repository=$(jq -r .model.repository "$manifest")
revision=$(jq -r .model.revision "$manifest")
file=$(jq -r .model.file "$manifest")
model_hash=$(jq -r .model.sha256 "$manifest")
model_bytes=$(jq -r .model.bytes "$manifest")
archive=$(jq -r .runtime.archive "$manifest")
runtime_hash=$(jq -r .runtime.sha256 "$manifest")
release=$(jq -r .runtime.release "$manifest")
curl -fsSL --max-time 30 "https://huggingface.co/$repository/raw/$revision/$file" -o "$cache/model-lfs.txt"
rg -qx "oid sha256:$model_hash" "$cache/model-lfs.txt"
rg -qx "size $model_bytes" "$cache/model-lfs.txt"
curl -fsSL --max-time 30 "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/$release" -o "$cache/release.json"
jq -e --arg name "$archive" --arg digest "sha256:$runtime_hash" --arg rev "$(jq -r .runtime.revision "$manifest")" \
  '.target_commitish == $rev and any(.assets[]; .name == $name and .digest == $digest)' "$cache/release.json" >/dev/null
if [ ! -e "$cache/$archive" ]; then
  curl -fL --max-time 180 "https://github.com/ggml-org/llama.cpp/releases/download/$release/$archive" -o "$cache/$archive.partial"
  printf '%s  %s\n' "$runtime_hash" "$cache/$archive.partial" | sha256sum -c -
  mv "$cache/$archive.partial" "$cache/$archive"
fi
printf '%s  %s\n' "$runtime_hash" "$cache/$archive" | sha256sum -c -
if [ ! -d "$cache/llama-$release" ]; then tar -xzf "$cache/$archive" -C "$cache"; fi
# Compare every extracted regular file to the authenticated archive before use.
tar --compare -zf "$cache/$archive" -C "$cache"
if [ ! -e "$cache/$file" ]; then
  [ "$(df --output=avail -B1 "$cache" | tail -1)" -gt "$((model_bytes + 1073741824))" ]
  curl -fL --max-time 1800 --continue-at - "https://huggingface.co/$repository/resolve/$revision/$file" -o "$cache/$file.partial"
  [ "$(stat -c %s "$cache/$file.partial")" = "$model_bytes" ]
  printf '%s  %s\n' "$model_hash" "$cache/$file.partial" | sha256sum -c -
  mv "$cache/$file.partial" "$cache/$file"
fi
[ "$(stat -c %s "$cache/$file")" = "$model_bytes" ]
printf '%s  %s\n' "$model_hash" "$cache/$file" | sha256sum -c -
cp "$manifest" "$cache/verified-manifest.json"
sha256sum "$cache/llama-$release/llama-server" "$cache/llama-$release/libllama-server-impl.so" > "$cache/runtime-sha256.txt"
printf 'Verified local cache: %s\n' "$cache"
