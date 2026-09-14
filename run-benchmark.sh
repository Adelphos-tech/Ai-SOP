#!/bin/bash
set -e

CASE_ID=$1
CASE_FILE="/opt/ai/benchmarks/cases/${CASE_ID}.json"
OUTPUT_DIR="/opt/sop-ai-app/logs/benchmarks/openai-sol"

mkdir -p "$OUTPUT_DIR"

echo "===== RUNNING ${CASE_ID} ====="
echo "Start: $(date)"
echo "Case file: ${CASE_FILE}"

RESULT_FILE="${OUTPUT_DIR}/${CASE_ID}-result.json"
curl -sS --max-time 270 -X POST http://127.0.0.1:5010/api/benchmark/run \
  -H "Content-Type: application/json" \
  -d "{\"caseId\": \"${CASE_ID}\", \"caseFilePath\": \"${CASE_FILE}\"}" \
  -o "$RESULT_FILE"

echo "End: $(date)"
echo "Result saved to: ${RESULT_FILE}"
echo "Response size: $(wc -c < "$RESULT_FILE") bytes"
echo ""

python3 -c "
import json, re

with open('$RESULT_FILE') as f:
    result = json.load(f)

if result.get('status') == 'success':
    pr = result.get('pipelineResult', {})
    sop = pr.get('finalSop', '')
    word_count = len(sop.split())
    
    # Save final SOP
    with open('${OUTPUT_DIR}/${CASE_ID}-final.txt', 'w') as f:
        f.write(sop)
    
    # Get cost data (PipelineCost structure)
    cost = pr.get('cost', {})
    
    # Save usage
    with open('${OUTPUT_DIR}/${CASE_ID}-usage.json', 'w') as f:
        json.dump({
            'caseId': '$CASE_ID',
            'cost': cost,
            'duration': pr.get('duration', 0),
            'wordCount': word_count,
            'model': pr.get('model', ''),
        }, f, indent=2)
    
    # Fact review
    fr = pr.get('factReview', {})
    qr = pr.get('qualityReview', {})
    
    # Format checks
    has_md = bool(re.search(r'^#{1,6}\s', sop, re.M) or '**' in sop or re.search(r'^\s*[-*]\s', sop, re.M))
    
    # Save evaluation
    evaluation = {
        'caseId': '$CASE_ID',
        'wordCount': word_count,
        'wordRangeCompliance': 'PASS' if 900 <= word_count <= 1100 else 'CHECK',
        'markdown': 'FAIL' if has_md else 'PASS',
        'factReview': fr,
        'qualityReview': qr,
        'languageProfile': pr.get('languageProfile', {}),
        'referenceLeakage': result.get('referenceLeakage', {}),
        'duration': pr.get('duration', 0),
        'cost': cost,
    }
    with open('${OUTPUT_DIR}/${CASE_ID}-evaluation.json', 'w') as f:
        json.dump(evaluation, f, indent=2)
    
    print(f'STATUS: SUCCESS')
    print(f'Word count: {word_count}')
    print(f'Markdown: {\"FAIL\" if has_md else \"PASS\"}')
    print(f'Fact check pass: {fr.get(\"pass\", False)}')
    print(f'Unsupported claims: {len(fr.get(\"unsupportedClaims\", []))}')
    print(f'Altered claims: {len(fr.get(\"alteredClaims\", []))}')
    
    scores = qr.get('scores', {})
    if scores:
        avg = sum(scores.values()) / len(scores)
        print(f'Quality average: {avg:.1f}/10')
    
    # Cost from PipelineCost structure
    if cost:
        usd = cost.get('estimatedApiCostUSD', 0)
        inr = cost.get('estimatedApiCostINR', 0)
        total_in = cost.get('totalInputTokens', 0)
        total_cached = cost.get('totalCachedInputTokens', 0)
        total_out = cost.get('totalOutputTokens', 0)
        total_tok = cost.get('totalTokens', 0)
        fx = cost.get('exchangeRate', {})
        print(f'Cost USD: \${usd:.4f}')
        print(f'Cost INR: ₹{inr:.2f}')
        print(f'Input tokens: {total_in:,}')
        print(f'Cached tokens: {total_cached:,}')
        print(f'Output tokens: {total_out:,}')
        print(f'Total tokens: {total_tok:,}')
        print(f'USD/INR: ₹{fx.get(\"rate\", 0):.2f}')
        print(f'Duration: {pr.get(\"duration\", 0)/1000:.1f}s')
        stages = cost.get('stages', [])
        for s in stages:
            print(f'  {s[\"stage\"]:25s} in={s[\"inputTokens\"]:5d} cached={s[\"cachedInputTokens\"]:5d} out={s[\"outputTokens\"]:5d} \${s[\"estimatedCostUsd\"]:.4f} {s[\"durationMs\"]/1000:.1f}s')
else:
    print(f'STATUS: {result.get(\"status\", \"ERROR\")}')
    print(f'ERROR: {result.get(\"error\", \"Unknown\")}')
    if result.get('partialCost'):
        print(f'Partial cost: {json.dumps(result[\"partialCost\"], indent=2)}')
"
echo ""
echo "===== ${CASE_ID} COMPLETE ====="
