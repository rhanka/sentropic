#!/usr/bin/env bash
# Parse only the named operator fields as data. Never evaluate dotenv syntax.
read_operator_env() {
  local line key value
  local -A fields=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    if [[ "$line" =~ ^(export[[:space:]]+)?(REGISTRY|DOCKER_USERNAME|DOCKER_PASSWORD)= ]]; then
      key=${BASH_REMATCH[2]}
      value=${line#*=}
      [[ ! -v fields[$key] ]] || { echo 'coverage-blocked: duplicate operator field' >&2; return 1; }
      if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
        value=${value:1:${#value}-2}
      elif [[ "$value" =~ [[:space:]\"\'] ]]; then
        echo 'coverage-blocked: unsupported operator field quoting' >&2; return 1
      fi
      [[ -n "$value" ]] || { echo 'coverage-blocked: empty operator field' >&2; return 1; }
      fields[$key]=$value
    fi
  done < "$1"
  [[ ${#fields[@]} == 3 ]] || { echo 'coverage-blocked: missing operator field' >&2; return 1; }
  REGISTRY=${fields[REGISTRY]}
  DOCKER_USERNAME=${fields[DOCKER_USERNAME]}
  DOCKER_PASSWORD=${fields[DOCKER_PASSWORD]}
}
