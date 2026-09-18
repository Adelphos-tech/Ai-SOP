#!/bin/bash
# ============================================================
# Validation corpus runner v2 — guarded, resumable, dry-runable
#
# Guards (hard stops, checked before EVERY generation):
#   MAX_EXPERIMENT_COST_INR=<n>      stop when cumulative INR >= n
#   MAX_EXPERIMENT_GENERATIONS=<n>   stop after n new generations
#   EXPERIMENT_DRY_RUN=1             print plan only, NO OpenAI calls
#
# Resume: completed cases in tests/corpus-results.json are SKIPPED.
# Historical CONTROL: existing generations are used as control;
# CONTROL is only regenerated when no historical equivalent exists.
# ============================================================
cd /tmp/sop-exp
export SOP_DB_HOST=127.0.0.1 SOP_DB_PORT=3306
export SOP_DB_USER=sop_test SOP_DB_PASSWORD=contract_test_9f2 SOP_DB_NAME=sop_ai_app_test
export OPENAI_API_KEY=$(grep "^OPENAI_API_KEY=" /opt/sop-ai-app/.env.local | cut -d= -f2-)

MANIFEST=tests/corpus-results.json
MAX_COST=${MAX_EXPERIMENT_COST_INR:-300}
MAX_GENS=${MAX_EXPERIMENT_GENERATIONS:-6}
DRY=${EXPERIMENT_DRY_RUN:-0}

# ---- corpus: "caseId|studentId|applicationId|documentId|type|controlGenId"
# controlGenId = existing generation to use as CONTROL ("" = none -> needs CONTROL run)
CORPUS=(
"Bench-SOP-sparse|41880eb7-fe48-4d0d-9946-1ec60325ba77|498ac77a-8d37-4f25-8c52-576eb909c851|158ab01c-d2db-4fbb-bc07-c588e26298b2|STATEMENT_OF_PURPOSE|"
"Kunj-SOP|b27a7a16-ac81-4a6f-93d7-0692f3849a9c|025e28d0-a6cb-407f-87ff-f0b3b32d70f0|19b805f3-34e3-4195-a442-634850d9fa5e|STATEMENT_OF_PURPOSE|4ac577d1-42b6-46b4-9230-bb085a0eea37"
"Moksh-SOP|45e4a41d-9940-4dc8-8b59-22683a0efb9c|d18e5262-8328-45d3-83d6-a5b1969b8859|3de52cb4-bf31-445d-8ad7-1eec355c2386|STATEMENT_OF_PURPOSE|47b7df4b-b853-4eaa-8a9f-f629b316d8ac"
"Moksh-VISA|45e4a41d-9940-4dc8-8b59-22683a0efb9c|d18e5262-8328-45d3-83d6-a5b1969b8859|e4ad8a6b-3aed-48ff-9f77-31192aef66ab|VISA_SOP|"
"Kunj-PS|b27a7a16-ac81-4a6f-93d7-0692f3849a9c|025e28d0-a6cb-407f-87ff-f0b3b32d70f0|7fb24415-d19b-47e2-a1b0-c3d5fa963059|PERSONAL_STATEMENT|"
"Moksh-SUPP|45e4a41d-9940-4dc8-8b59-22683a0efb9c|d18e5262-8328-45d3-83d6-a5b1969b8859|fa5ff399-fb4d-4ea9-ad71-e662faf5a20c|SUPPLEMENTAL_QUESTION|"
"Moksh-SAP|45e4a41d-9940-4dc8-8b59-22683a0efb9c|d18e5262-8328-45d3-83d6-a5b1969b8859|7aee9cff-c312-4bae-877e-2737e36599f7|STATEMENT_OF_ACADEMIC_PURPOSE|"
"Kunj-LOM|b27a7a16-ac81-4a6f-93d7-0692f3849a9c|025e28d0-a6cb-407f-87ff-f0b3b32d70f0|454d71f2-7bfc-499f-995d-f5aab25264ee|LETTER_OF_MOTIVATION|"
"Kunj-LOR|b27a7a16-ac81-4a6f-93d7-0692f3849a9c|025e28d0-a6cb-407f-87ff-f0b3b32d70f0|39936859-41b7-4baf-8cc6-d9d69011e869|LETTER_OF_RECOMMENDATION|"
"Moksh-COVER|45e4a41d-9940-4dc8-8b59-22683a0efb9c|d18e5262-8328-45d3-83d6-a5b1969b8859|81d98f56-9d8f-4972-acb2-fe4509e5c81b|COVER_LETTER|"
"Shivang-ESSAY|65783a5e-c245-413d-b939-b6a3e244b593|d054d6e7-606c-43ee-a3dd-66c91a42f55e|e5ceb896-26c6-46bf-b82d-686c9d9a8f57|ESSAY|"
"Shivang-SOP|65783a5e-c245-413d-b939-b6a3e244b593|d054d6e7-606c-43ee-a3dd-66c91a42f55e|538937b6-d5c8-44a3-b917-d524befee965|STATEMENT_OF_PURPOSE|"
)

# ---- helpers ------------------------------------------------
completed_variant() {  # caseId variant -> 0 if already done
  python3 -c "
import json,sys
m=json.load(open('$MANIFEST')) if __import__('os').path.exists('$MANIFEST') else []
sys.exit(0 if any(r['caseId']=='$1' and r['variant']=='$2' and r['status']=='success' for r in m) else 1)
"
}
cumulative_inr() {
  python3 -c "
import json,os
m=json.load(open('$MANIFEST')) if os.path.exists('$MANIFEST') else []
print(round(sum(r.get('costUsd',0) for r in m)*96.03,2))
"
}
record() {  # caseId variant genId status calls usd
  python3 -c "
import json,os
m=json.load(open('$MANIFEST')) if os.path.exists('$MANIFEST') else []
m=[r for r in m if not (r['caseId']=='$1' and r['variant']=='$2')]
m.append({'caseId':'$1','variant':'$2','generationId':'$3','status':'$4','calls':$5,'costUsd':$6,'completedAt':'$(date -u +%FT%TZ)'})
json.dump(m,open('$MANIFEST','w'),indent=2)
"
}

# Optional case filter: CORPUS_CASES="Bench-SOP-sparse,Moksh-VISA,Kunj-PS"
# Fresh CONTROL runs are DISABLED by default (spec: only generate AB/ABD;
# CONTROL = existing historical generation). Set ALLOW_FRESH_CONTROL=1 to
# permit CONTROL when a case has genuinely no historical equivalent.
IFS=',' read -ra CASE_FILTER <<< "${CORPUS_CASES:-}"
want_case() {
  [ ${#CASE_FILTER[@]} -eq 0 ] && return 0
  for c in "${CASE_FILTER[@]}"; do [ "$c" = "$1" ] && return 0; done
  return 1
}

# ---- plan ---------------------------------------------------
NEW_RUNS=()
for entry in "${CORPUS[@]}"; do
  IFS='|' read -r caseId sid aid did dtype ctrl <<< "$entry"
  want_case "$caseId" || continue
  if [ -n "$ctrl" ]; then
    : # historical control exists — no paid run needed
  elif [ "${ALLOW_FRESH_CONTROL:-0}" = "1" ] && ! completed_variant "$caseId" "CONTROL"; then
    NEW_RUNS+=("$caseId|CONTROL|$sid|$aid|$did|$dtype")
  fi
  for v in AB ABD; do
    completed_variant "$caseId" "$v" || NEW_RUNS+=("$caseId|$v|$sid|$aid|$did|$dtype")
  done
done

echo "===== VALIDATION PLAN ====="
echo "planned new generations: ${#NEW_RUNS[@]} (cap $MAX_GENS, budget Rs.$MAX_COST)"
echo "cumulative spend so far: Rs.$(cumulative_inr)"
for r in "${NEW_RUNS[@]}"; do IFS='|' read -r c v s a d t <<< "$r"; echo "  $c | $v | $t"; done
[ "$DRY" = "1" ] && { echo "DRY RUN — no calls made"; exit 0; }

# ---- execute ------------------------------------------------
GEN_COUNT=0
for r in "${NEW_RUNS[@]}"; do
  IFS='|' read -r caseId v sid aid did dtype <<< "$r"
  SPENT=$(cumulative_inr)
  over_budget=$(python3 -c "print(1 if float('$SPENT') >= float('$MAX_COST') else 0)")
  if [ "$over_budget" = "1" ]; then echo "BUDGET GUARD: Rs.$SPENT >= Rs.$MAX_COST — STOPPING"; break; fi
  if [ "$GEN_COUNT" -ge "$MAX_GENS" ]; then echo "GENERATION GUARD: $GEN_COUNT >= $MAX_GENS — STOPPING"; break; fi

  gid=$(cat /proc/sys/kernel/random/uuid)
  extra=""; models=""
  case $v in
    CONTROL) extra="DISABLE_COMPACT_REVIEWS=1 DISABLE_NARRATIVE_PROFILES=1" ;;
    AB) ;; # A+B is production default — no flags needed
    ABD) models="OPENAI_MODEL_QUALITY_REVIEWER=gpt-5.6-terra OPENAI_MODEL_LANGUAGE_CALIBRATOR=gpt-5.6-terra OPENAI_MODEL_FINALIZER=gpt-5.6-terra" ;;
  esac
  echo "===== RUN $caseId | $v | $gid ====="
  env EXP_NAME="${v}-${caseId}" EXP_GENERATION_ID="$gid" $extra $models \
    npx tsx tests/experiment-replay.ts "$sid" "$aid" "$did" > /tmp/last-run.log 2>&1
  status="success"; calls=6; usd=0
  grep -q "status: success" /tmp/last-run.log || status="partial"
  usd=$(python3 -c "
import json,os
p='logs/attempts/$gid/attempts.jsonl'
t=0
if os.path.exists(p):
  for l in open(p):
    e=json.loads(l)
    if e['type']=='USAGE_RECORDED': t+=e['data']['usage']['estimatedCostUsd']
print(round(t,6))")
  calls=$(python3 -c "
import json,os
p='logs/attempts/$gid/attempts.jsonl'; n=0
if os.path.exists(p):
  for l in open(p):
    if json.loads(l)['type']=='USAGE_RECORDED': n+=1
print(n)")
  tail -14 /tmp/last-run.log
  record "$caseId" "$v" "$gid" "$status" "$calls" "$usd"
  GEN_COUNT=$((GEN_COUNT+1))
done
echo "CORPUS RUN COMPLETE — $GEN_COUNT new generations"
