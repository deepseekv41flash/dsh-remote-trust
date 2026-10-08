#!/bin/bash
# dsh-remote-trust ships no compilation step: lib/index.js is dependency-free ESM
# and is both the source and the runtime artifact. This script validates the entry
# and runs the suite, so the standard dev_build_plugin pipeline has something real
# to run — and fails loudly on a broken file.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

node --input-type=module -e "
import { pathToFileURL } from 'node:url'
const m = await import(pathToFileURL('lib/index.js').href)
if (typeof m.name !== 'string' || m.name === '') throw new Error('name export missing')
if (!Array.isArray(m.inject)) throw new Error('inject export missing')
if (typeof m.apply !== 'function') throw new Error('apply export missing')
console.log('dsh-remote-trust: lib/index.js OK — name=' + m.name + ' inject=' + m.inject.join(','))
"

node --test "test/*.test.js"
