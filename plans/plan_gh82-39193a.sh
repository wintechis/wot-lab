#!/usr/bin/env bash
#
# Executes the optimal plan of task "s6" (mosaik, L3: "Produce the smartphone.")
# with the Samsung Galaxy S26 battery: spare part GH82-39193A (Samsung EB-BS942ABE),
# the battery resource "gh82-39193a" in place of the generic battery product,
# as a sequence of HTTP POST requests:
#
#   POST <BASE_URI>/<thing>/actions/<action>
#   (with the input sent as a text/plain body when it is not empty, or as an
#   application/json body when it is an object)
#
# Usage:
#   ./plans/plan_gh82-39193a.sh http://localhost:8080          # base URI as first argument
#   BASE_URI=http://localhost:8080 ./plans/plan_gh82-39193a.sh # or as environment variable
#
# Optional environment variables:
#   DELAY=0.2          seconds to wait between requests (default: 0)
#   CONTINUE_ON_ERROR=1   keep going if a request fails (default: stop)

set -u

BASE_URI="${1:-${BASE_URI:-}}"
if [ -z "$BASE_URI" ]; then
  echo "Usage: $0 <BASE_URI>   (or set BASE_URI in the environment)" >&2
  exit 1
fi
BASE_URI="${BASE_URI%/}"   # strip a trailing slash

DELAY="${DELAY:-0}"
CONTINUE_ON_ERROR="${CONTINUE_ON_ERROR:-0}"
TOTAL=618
N=0

step() {
  local thing="$1" action="$2" input="${3:-}"
  local url="${BASE_URI}/${thing}/actions/${action}"
  local status
  N=$((N + 1))

  if [ "${input#\{}" != "$input" ]; then
    # An object input (e.g. a recipe's trigger plus the battery it uses) is JSON.
    printf '[%3d/%d] POST %s  <- %s\n' "$N" "$TOTAL" "$url" "$input"
    status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
      -H 'Content-Type: application/json' --data-raw "$input" "$url")
  elif [ -n "$input" ]; then
    printf '[%3d/%d] POST %s  <- "%s"\n' "$N" "$TOTAL" "$url" "$input"
    status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
      -H 'Content-Type: text/plain' --data-raw "$input" "$url")
  else
    printf '[%3d/%d] POST %s\n' "$N" "$TOTAL" "$url"
    status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
      -H 'Content-Length: 0' "$url")
  fi

  if [ "${status:-000}" -lt 200 ] || [ "${status:-000}" -ge 300 ]; then
    echo "        -> failed with HTTP status ${status:-000}" >&2
    [ "$CONTINUE_ON_ERROR" = "1" ] || exit 1
  fi

  [ "$DELAY" = "0" ] || sleep "$DELAY"
}

# ---------------------------------------------------------------------------
# Plan (618 steps)
# ---------------------------------------------------------------------------
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 pickup batterycell
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 drop
step combine produceBattery '{"trigger": "produceIt", "battery": "gh82-39193a"}'
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 pickup ingot
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 drop
step casting produceCase produceIt
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 pickup cpu
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveDown
step t1 moveDown
step t1 drop
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 pickup mainboard
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 drop
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 pickup flash
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 drop
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 pickup ram
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 drop
step solder1 produceMainModule produceIt
step t1 pickup mainmodule
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 drop
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 pickup port
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 drop
step fixing produceMainModuleWithPorts produceIt
step t1 pickup mainmodulewithports
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 drop
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 pickup case
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 drop
step bolt1 produceCaseWithMainModule produceIt
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 pickup mainboard2
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveDown
step t1 moveDown
step t1 drop
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 pickup comm
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 drop
step solder2 produceCommunicationModule produceIt
step t1 pickup communicationmodule
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveUp
step t1 moveUp
step t1 drop
step bolt1 produceCaseWithCommunicationModule produceIt
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 pickup mainboard3
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveDown
step t1 moveDown
step t1 drop
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 pickup sensor
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 drop
step solder2 produceSensorModule produceIt
step t1 pickup sensormodule
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveUp
step t1 moveUp
step t1 drop
step bolt1 produceCaseWithSensorModule produceIt
step t1 pickup casewithsensormodule
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 drop
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 pickup gh82-39193a
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 drop
step glue1 produceCaseWithBattery '{"trigger": "produceIt", "battery": "gh82-39193a"}'
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 pickup glass
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 drop
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveRight
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 moveDown
step t1 pickup lcd
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveLeft
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 moveUp
step t1 drop
step glue1 produceDisplayUnit produceIt
step glue1 produceSmartphone produceIt

echo "Done: all $TOTAL steps executed."

