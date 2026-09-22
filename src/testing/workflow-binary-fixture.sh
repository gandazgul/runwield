#!/bin/sh
# External command fixtures only. Each invocation keeps evidence beside its
# per-test link, while every test reuses this executable's immutable contents.
fixture_bin_dir=${0%/*}
fixture_name=${0##*/}
printf '%s\n' "$fixture_name" "$@" >> "$fixture_bin_dir/calls.log"
case "$fixture_name" in
mnemoteca)
case "$1" in
  --help) echo 'Usage: mnemoteca <command>'; exit 0 ;;
  update)
    if [ "$2" = "--help" ]; then
      echo 'Usage: mnemoteca update <id> --replace-tags'; exit 0
    fi ;;
  list) echo 'No documents'; exit 0 ;;
  search) echo '{"results":[]}'; exit 0 ;;
  init|add|forget) exit 0 ;;
  export)
    shift
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--output" ] && [ "$#" -ge 2 ]; then
        shift
        mkdir -p "$(dirname "$1")"
        printf '%s\n' '{"type":"mnemoteca-export"}' > "$1"
        exit 0
      fi
      shift
    done ;;
esac
;;
cymbal)
case "$*" in
  --help) echo 'Usage: cymbal <command>'; exit 0 ;;
  'index .') exit 0 ;;
esac
if [ "$1" = "--no-federate" ] && [ "$2" = "hook" ] && [ "$3" = "nudge" ] && [ "$4" = "--format=text" ] && [ "$5" = "--" ]; then
  exit 0
fi
;;
ketch)
if [ "$*" = "--help" ]; then echo 'Usage: ketch <command>'; exit 0; fi
;;
osascript)
if [ "$#" -eq 2 ] && [ "$1" = "-e" ] && [ "$2" = 'try
        the clipboard as «class PNGf»
        return "image"
      on error
        return "none"
      end try' ]; then
  echo none
  exit 0
fi
;;
gh) echo 'golden fixture: gh unavailable' >&2; exit 1 ;;
esac
printf 'Unsupported %s fixture call: %s\n' "$fixture_name" "$*" >> "$fixture_bin_dir/unexpected.log"
printf 'Unsupported %s fixture call: %s\n' "$fixture_name" "$*" >&2
exit 64
