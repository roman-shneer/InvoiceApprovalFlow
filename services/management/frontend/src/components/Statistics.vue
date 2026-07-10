<script setup>
const props = defineProps({
  api: {
    type: Object,
    required: true
  }
});
</script>

<template>
    <h1>Statistics</h1>

    <div class="stats-header">
        <button @click="loadStatistics">Refresh</button>
        <div class="kpis">
            <div class="kpi-card">
                <div class="kpi-label">Total Invoices</div>
                <div class="kpi-value">{{ totals.total }}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">STP (AUTO_APPROVE)</div>
                <div class="kpi-value">{{ stpPercent }}%</div>
            </div>
            <div class="kpi-card" :class="{ warning: riskyAutoApprovals > 0 }">
                <div class="kpi-label">Policy Bypasses</div>
                <div class="kpi-value">{{ riskyAutoApprovals }}</div>
            </div>
        </div>
    </div>

    <div class="grid">
        <section class="panel">
            <h2>Payments per Department</h2>            
            <table border=1 style="border-collapse: collapse;width:100%;">
                <tbody>
                    <tr>
                        <td>Department</td>
                        <td>Budget</td>
                        <td>Orders</td>
                        <td>Commitments</td>                        
                        <td>Bills</td>
                        <td>Paid Amount</td>
                    </tr>
                    <tr v-for="department of Object.values(departmentInvoices)">
                        <td>{{ department.name }}</td>
                        <td>${{ budgets[department.name] || 0 }}</td>
                        <td>{{department.orderedCount}}</td>
                        <td>${{ department.orderedAmount }} ({{ (department.orderedAmount / (budgets[department.name] || 1) * 100).toFixed(2) }}%)</td>
                        <td>{{ department.paymentCount }}</td>
                        <td>${{ department.paymentAmount }} ({{ (department.paymentAmount / (budgets[department.name] || 1) * 100).toFixed(2) }}%)</td>
                    </tr>
                </tbody>
            </table>
        </section>

        <section class="panel">
            <h2>Invoice Statuses per Department</h2>            
            <table border=1  style="border-collapse: collapse;width:100%;">
                <tbody>
                    <tr>
                       <td>Department</td>
                       <td>Total</td>
                       <td>Auto Approved</td>
                       <td>Manually Approved</td>
                       <td>Under Review</td>
                       <td>Rejected</td>
                    </tr>
                    <tr v-for="department of Object.values(departmentInvoices)">
                        <td>{{ department.name }}</td>                        
                        <td>{{ department.total }}</td>
                        <td>{{ department.AUTO_APPROVE }}</td>
                        <td>{{ department.APPROVED }}</td>
                        <td>{{ department.HUMAN_REVIEW }}</td>
                        <td>{{ department.REJECT }}</td>
                    </tr>
                </tbody>
            </table>
        </section>
        
        <section class="panel">
            <h2>Invoice Route Distribution</h2>
            <p class="hint">Shows automation ratio and trust in deterministic routing.</p>
            <div class="donut-wrap">
                <div class="donut" :style="donutStyle"></div>
                <div class="legend">
                    <div class="legend-row"><span class="dot auto"></span>AUTO_APPROVE: {{ routeCounts.AUTO_APPROVE }}</div>
                    <div class="legend-row"><span class="dot review"></span>HUMAN_REVIEW: {{ routeCounts.HUMAN_REVIEW }}</div>
                    <div class="legend-row"><span class="dot reject"></span>REJECT: {{ routeCounts.REJECT }}</div>                    
                </div>
            </div>
        </section>

        <section class="panel">
            <h2>Top Manual Review Triggers</h2>
            <p class="hint">Most frequent rules causing HUMAN_REVIEW escalation.</p>
            <div v-if="topTriggers.length === 0" class="empty">No HUMAN_REVIEW triggers found in current data.</div>
            <div v-else class="bars">
                <div class="bar-row" v-for="row in topTriggers" :key="row.rule">
                    <div class="bar-label">{{ row.rule }}</div>
                    <div class="bar-track">
                        <div class="bar-fill" :style="{ width: toPercent(row.count, topTriggerMax) + '%' }"></div>
                    </div>
                    <div class="bar-value">{{ row.count }}</div>
                </div>
            </div>
        </section>

        <section class="panel panel-wide">
            <h2>Scannable Security Matrix</h2>
            <p class="hint">Invoice Amount ($), AI Confidence Level. Green = AUTO_APPROVE, Red = HUMAN_REVIEW, BLACK = REJECT.</p>
            <svg :viewBox="`0 0 ${svg.width} ${svg.height}`" class="scatter">
                <line :x1="svg.left" :y1="svg.top" :x2="svg.left" :y2="svg.bottom" class="axis" />
                <line :x1="svg.left" :y1="svg.bottom" :x2="svg.right" :y2="svg.bottom" class="axis" />

                <line :x1="xForAmount(autonomy.ceiling)" :y1="svg.top" :x2="xForAmount(autonomy.ceiling)" :y2="svg.bottom" class="limit" />
                <line :x1="svg.left" :y1="yForConfidence(autonomy.confidence)" :x2="svg.right" :y2="yForConfidence(autonomy.confidence)" class="limit" />

                <text :x="xForAmount(autonomy.ceiling) + 4" :y="svg.top + 14" class="limit-label">AUTONOMY-CEILING {{ autonomy.ceiling }}</text>
                <text :x="svg.left + 4" :y="yForConfidence(autonomy.confidence) - 6" class="limit-label">AUTONOMY-CONFIDENCE {{ autonomy.confidence }}</text>

                <circle
                    v-for="(point, idx) in scatterPoints"
                    :key="idx"
                    :cx="xForAmount(point.amount)"
                    :cy="yForConfidence(point.confidence)"
                    r="4.5"
                    :class="point.status === 'AUTO_APPROVE' ? 'point-auto' : 'point-review'"
                />

                <text :x="svg.right - 120" :y="svg.bottom + 22" class="axis-label">Amount (USD)</text>
                <text :x="svg.left - 30" :y="svg.top + 12" class="axis-label">Conf.</text>
            </svg>
            <div class="legend-inline">
                <span><span class="dot auto"></span>AUTO_APPROVE</span>
                <span><span class="dot review"></span>HUMAN_REVIEW</span>
                <span><span class="dot reject"></span>REJECT</span>
            </div>
        </section>
    </div>
</template>

<script>
export default {
    name: 'Statistics',
    data() {
        return {
            departmentInvoices:{},
            budgets:{},
            routeCounts: {
                AUTO_APPROVE: 0,
                APPROVED:0,
                HUMAN_REVIEW: 0,
                REJECT: 0,                
            },
            totals: {
                total: 0
            },
            autonomy: {
                ceiling: 250,
                confidence: 0.8
            },
            topTriggers: [],
            scatterPoints: [],
            topTriggerMax: 1,
            riskyAutoApprovals: 0,
            svg: {
                width: 920,
                height: 360,
                left: 56,
                right: 900,
                top: 24,
                bottom: 320
            },
            maxAmount: 1
        };
    },
    computed: {
        
        donutStyle() {
            
            const total = (this.totals.total) || 1;
            const auto = (this.routeCounts.AUTO_APPROVE / total) * 100;            
            const review = (this.routeCounts.HUMAN_REVIEW / total) * 100;
            const reject = (this.routeCounts.REJECT / total) * 100;
            
            return {
                background: `conic-gradient(#0f9d58 0% ${auto}%, #d93025 ${auto}% ${auto + review}%, #000000 ${auto + review}% ${auto  + review + reject}%)`
            };
        },
        stpPercent() {
            if (!this.totals.total) return '0.0';
            return ((this.routeCounts.AUTO_APPROVE / this.totals.total) * 100).toFixed(1);
        }
    },
    methods: {
        statusToClass(status){
            const classes={
                'AUTO_APPROVE': 'point-auto',
                'APPROVED': 'point-approved',
                'HUMAN_REVIEW': 'point-review',
                'REJECT': 'point-reject'
            }
            return classes[status] || '';
        },
        normalizeStatus(invoice) {
            const status = String(invoice?.status || invoice?.expected?.route || '').toUpperCase();
            if (status === 'AUTO_APPROVE') return 'AUTO_APPROVE';
            if (status === 'HUMAN_REVIEW') return 'HUMAN_REVIEW';            
            return status;
        },
        extractAmount(invoice) {
            const parsed = parseFloat(invoice?.amount ?? invoice?.total ?? 0);
            return Number.isNaN(parsed) ? 0 : parsed;
        },
        extractConfidence(invoice) {
            const candidates = [
                invoice?.confidence,
                invoice?.ai?.confidence,
                invoice?.audit_metadata?.confidence,
                invoice?.audit_metadata?.ai_confidence
            ];
            for (const c of candidates) {
                const parsed = parseFloat(c);
                if (!Number.isNaN(parsed)) return parsed;
            }
            return null;
        },
        extractTriggeredRules(invoice) {
            const rules = invoice?.audit_metadata?.triggered_rules;
            if (Array.isArray(rules)) return rules;
            return [];
        },
        toPercent(value, max) {
            if (!max) return 0;
            return Math.min(100, (value / max) * 100);
        },
        xForAmount(amount) {
            const xSpan = this.svg.right - this.svg.left;
            const ratio = Math.max(0, Math.min(1, amount / this.maxAmount));
            return this.svg.left + ratio * xSpan;
        },
        yForConfidence(confidence) {
            const ySpan = this.svg.bottom - this.svg.top;
            const clamped = Math.max(0, Math.min(1, confidence));
            return this.svg.bottom - clamped * ySpan;
        },
        async loadStatistics() {
            const data = await this.api.GetStatistics();
            const invoices = Array.isArray(data?.invoices) ? data.invoices : [];
            const budgets = Array.isArray(data?.budgets) ? data.budgets : [];

            const ceiling = parseFloat(data?.autonomy?.ceiling);
            const confidence = parseFloat(data?.autonomy?.confidence);
            this.autonomy = {
                ceiling: Number.isNaN(ceiling) ? 250 : ceiling,
                confidence: Number.isNaN(confidence) ? 0.8 : confidence
            };

            const routeCounts = { AUTO_APPROVE: 0, APPROVED: 0,  HUMAN_REVIEW: 0, REJECT:0};
            const triggerCounter = {};
            const scatter = [];
            let riskyAutoApprovals = 0;
            let maxAmount = this.autonomy.ceiling;
            let departmentInvoices = {};
            for(const budget of budgets){
                this.budgets[budget.value.department]=budget.value.amount;
            }
            for (const invoice of invoices) {
                const status = this.normalizeStatus(invoice);
                if (routeCounts[status] !== undefined) {
                    routeCounts[status] += 1;
                }

                if(typeof departmentInvoices[invoice.department]=='undefined'){
                    departmentInvoices[invoice.department]={   
                        name:invoice.department,                     
                        orderedCount:0,
                        orderedAmount:0,
                        paymentCount:0,
                        paymentAmount:0,
                        AUTO_APPROVE:0,
                        APPROVED:0,
                        HUMAN_REVIEW:0,
                        REJECT:0,
                        total:0 
                    };
                }
                const amount = this.extractAmount(invoice);
                departmentInvoices[invoice.department].orderedCount+=1;
                departmentInvoices[invoice.department].orderedAmount+=amount;
                if(invoice.payment && invoice.payment.status=='CONFIRMED'){
                    departmentInvoices[invoice.department].paymentCount+=1;
                    departmentInvoices[invoice.department].paymentAmount+=parseFloat(invoice.payment.amount);
                }
                departmentInvoices[invoice.department][status]+=1;
                departmentInvoices[invoice.department].total+=1;

                const confidenceValue = this.extractConfidence(invoice);                
                maxAmount = Math.max(maxAmount, amount || 0);

                if ((status === 'AUTO_APPROVE' || status === 'HUMAN_REVIEW' || status === 'REJECT') && confidenceValue !== null) {
                    scatter.push({ amount, confidence: confidenceValue, status });                    
                    if (status === 'AUTO_APPROVE' && (amount > this.autonomy.ceiling || confidenceValue < this.autonomy.confidence)) {
                        riskyAutoApprovals += 1;
                    }
                }

                if (status === 'HUMAN_REVIEW' || status === 'REJECT') {
                    for (const rule of this.extractTriggeredRules(invoice)) {
                        const key = String(rule || '').trim();
                        if (!key) continue;
                        triggerCounter[key] = (triggerCounter[key] || 0) + 1;
                    }
                }
            }

            const sortedTriggers = Object.entries(triggerCounter)
                .map(([rule, count]) => ({ rule, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 12);

            this.routeCounts = routeCounts;
            this.totals.total = scatter.length;
            this.topTriggers = sortedTriggers;
            this.topTriggerMax = sortedTriggers.length ? sortedTriggers[0].count : 1;
            this.scatterPoints = scatter;
            this.maxAmount = Math.max(1, maxAmount * 1.1);
            this.riskyAutoApprovals = riskyAutoApprovals;
            this.departmentInvoices = departmentInvoices;
        }
    },
    mounted() {
        this.loadStatistics();
    }
};
</script>

<style scoped>
.stats-header {
    margin-bottom: 16px;
}

.kpis {
    display: grid;
    grid-template-columns: repeat(3, minmax(140px, 1fr));
    gap: 10px;
    margin-top: 10px;
}

.kpi-card {
    border: 1px solid #d8d8d8;
    border-radius: 8px;
    padding: 10px;
    text-align: left;
    background: #fff;
}

.kpi-card.warning {
    border-color: #d93025;
    background: #fff4f2;
}

.kpi-label {
    font-size: 12px;
    color: #5f6368;
}

.kpi-value {
    font-size: 22px;
    font-weight: 600;
    color: #202124;
}

.grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(280px, 1fr));
    gap: 14px;
}

.panel {
    border: 1px solid #d8d8d8;
    border-radius: 10px;
    padding: 12px;
    background: #fff;
    text-align: left;
}

.panel-wide {
    grid-column: span 2;
}

.hint {
    color: #5f6368;
    margin-bottom: 12px;
    font-size: 14px;
}

.donut-wrap {
    display: flex;
    align-items: center;
    gap: 16px;
}

.donut {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    position: relative;
}

.donut::after {
    content: '';
    position: absolute;
    inset: 22px;
    background: #fff;
    border-radius: 50%;
}

.legend {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.legend-row {
    font-size: 14px;
}

.dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 6px;
}

.dot.auto {
    background: #0f9d58;
}

.dot.approved {
    background: #03f47f;
}

.dot.review {
    background: #d93025;
}

.dot.reject {
    background: #000;
}

.bars {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.bar-row {
    display: grid;
    grid-template-columns: 220px 1fr 44px;
    gap: 8px;
    align-items: center;
}

.bar-label,
.bar-value {
    font-size: 13px;
}

.bar-track {
    height: 10px;
    border-radius: 999px;
    background: #ececec;
    overflow: hidden;
}

.bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #f57c00, #ef6c00);
}

.empty {
    color: #5f6368;
}

.scatter {
    width: 100%;
    height: auto;
    border: 1px solid #ececec;
    background: #fcfcfc;
}

.axis {
    stroke: #9aa0a6;
    stroke-width: 1;
}

.limit {
    stroke: #5f6368;
    stroke-width: 1;
    stroke-dasharray: 5 4;
}

.limit-label {
    fill: #5f6368;
    font-size: 11px;
}

.axis-label {
    fill: #5f6368;
    font-size: 12px;
}

.point-auto {
    fill: #0f9d58;
    opacity: 0.88;
}
.point-approved {
    fill: #03f47f;
    opacity: 0.88;
}
.point-review {
    fill: #d93025;
    opacity: 0.88;
}
.point-reject {
    fill: #000;
    opacity: 0.88;
}

.legend-inline {
    margin-top: 8px;
    display: flex;
    gap: 18px;
    font-size: 13px;
}

@media (max-width: 1024px) {
    .kpis {
        grid-template-columns: 1fr;
    }

    .grid {
        grid-template-columns: 1fr;
    }

    .panel-wide {
        grid-column: auto;
    }

    .donut-wrap {
        flex-direction: column;
        align-items: flex-start;
    }

    .bar-row {
        grid-template-columns: 140px 1fr 38px;
    }
}
</style>
