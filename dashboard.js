const DB = {
    ELE: { SH: [], DS: [], DOD: [] },
    SHA: { SH: [], DS: [], DOD: [] }
};

let activeDomain = 'ELE';
let activeTab = 'summary';
let activeLossTreeGroup = 'zone_sh';
let activeTrendSub = 'mstn';
let chartInstance = null;

const globalFilterKeys = ['master', 'final_fc', 'bu', 'sc', 'analytical_vertical', 'brand', 'remark', 'fsn', 'title', 'sh_p0', 'zone'];
const dsFilterKeys = ['current_flag', 'abhi_flag', 'common_flag', 'common_all_flag', 'new_all_flag', 'updated_flag', 'next2500_flag_new', 'business_zone'];
let currentFilters = {};

// 1. Fetch data from Google Drive natively
window.onload = function() {
    google.script.run
        .withSuccessHandler(processDriveData)
        .withFailureHandler(function(err) {
            alert('Error fetching files from Drive: ' + err.message);
            document.getElementById('loading-overlay').style.display = 'none';
        })
        .getDashboardData();
};

// 2. Parse the CSV strings
function processDriveData(payload) {
    const parseOpts = { header: true, skipEmptyLines: true, dynamicTyping: true };
    
    if (payload['loss_tree_ds_detail_ele.csv']) DB.ELE.DS = Papa.parse(payload['loss_tree_ds_detail_ele.csv'], parseOpts).data;
    if (payload['loss_tree_sh_detail_ele.csv']) DB.ELE.SH = Papa.parse(payload['loss_tree_sh_detail_ele.csv'], parseOpts).data;
    if (payload['dod_ele_sh.csv']) DB.ELE.DOD = Papa.parse(payload['dod_ele_sh.csv'], parseOpts).data;
    
    if (payload['loss_tree_ds_detail_sha.csv']) DB.SHA.DS = Papa.parse(payload['loss_tree_ds_detail_sha.csv'], parseOpts).data;
    if (payload['loss_tree_sh_detail_sha.csv']) DB.SHA.SH = Papa.parse(payload['loss_tree_sh_detail_sha.csv'], parseOpts).data;
    if (payload['dod_sha_sh.csv']) DB.SHA.DOD = Papa.parse(payload['dod_sha_sh.csv'], parseOpts).data;

    document.getElementById('loading-overlay').style.display = 'none';
    populateFilters();
    renderActiveView();
}

// --- UI Flow & Tab Switching ---
function switchDomain(domain) {
    activeDomain = domain;
    document.getElementById('toggle-ele').className = domain === 'ELE' ? 'btn' : 'btn inactive';
    document.getElementById('toggle-sha').className = domain === 'SHA' ? 'btn' : 'btn inactive';
    populateFilters();
    renderActiveView();
}
window.switchDomain = switchDomain;

function switchTab(tabName) {
    activeTab = tabName;
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    event.target.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.getElementById('content-' + tabName).style.display = 'block';
    document.getElementById('ds-filters').style.display = (tabName === 'ds_level') ? 'block' : 'none';
    renderActiveView();
}
window.switchTab = switchTab;

function switchLossTreeGroup(group) {
    activeLossTreeGroup = group;
    document.querySelectorAll('#loss-tree-subtabs .sub-tab').forEach(el => el.classList.remove('active'));
    event.target.classList.add('active');
    renderActiveView();
}
window.switchLossTreeGroup = switchLossTreeGroup;

function switchTrendSub(sub) {
    activeTrendSub = sub;
    document.getElementById('trend-tab-mstn').classList.toggle('active', sub === 'mstn');
    document.getElementById('trend-tab-instock').classList.toggle('active', sub === 'instock');
    renderActiveView();
}
window.switchTrendSub = switchTrendSub;

// --- Filters & Helpers ---
function getValSafe(row, key) {
    const lowerKey = key.toLowerCase();
    const actualKey = Object.keys(row).find(k => k.toLowerCase() === lowerKey);
    return actualKey ? row[actualKey] : undefined;
}

function populateFilters() {
    const createSelect = (key, targetDiv, dataSrc) => {
        const uniqueVals = [...new Set(dataSrc.map(row => getValSafe(row, key)).filter(v => v !== undefined && v !== ''))].sort();
        let html = `<div class="filter-group"><label>${key.toUpperCase()}</label><select id="filter_${key}"><option value="">All</option>`;
        uniqueVals.forEach(v => html += `<option value="${v}">${v}</option>`);
        html += `</select></div>`;
        return html;
    };

    const shData = DB[activeDomain].SH;
    const dsData = DB[activeDomain].DS;

    let gFiltersHtml = '';
    globalFilterKeys.forEach(k => gFiltersHtml += createSelect(k, 'global-filters', shData));
    document.getElementById('global-filters').innerHTML = gFiltersHtml;

    let dsFiltersHtml = '';
    dsFilterKeys.forEach(k => {
        if (dsData.length > 0 && Object.keys(dsData[0]).some(c => c.toLowerCase() === k.toLowerCase())) {
            dsFiltersHtml += createSelect(k, 'exclusive-ds-filters', dsData);
        }
    });
    document.getElementById('exclusive-ds-filters').innerHTML = dsFiltersHtml;
}

function applyFilters() {
    currentFilters = {};
    globalFilterKeys.forEach(k => {
        const el = document.getElementById(`filter_${k}`);
        if(el && el.value) currentFilters[k] = el.value;
    });
    dsFilterKeys.forEach(k => {
        const el = document.getElementById(`filter_${k}`);
        if(el && el.value) currentFilters[k] = el.value;
    });
    renderActiveView();
}
window.applyFilters = applyFilters;

function filterData(data, includeDS = false) {
    return data.filter(row => {
        for (const key in currentFilters) {
            if(!includeDS && dsFilterKeys.includes(key)) continue;
            const rowVal = getValSafe(row, key);
            if (rowVal !== undefined && String(rowVal) !== String(currentFilters[key])) return false;
        }
        return true;
    });
}

function safeSum(arr, key) {
    return arr.reduce((sum, row) => sum + (Number(getValSafe(row, key)) || 0), 0);
}

const formatPct = (val) => (val * 100).toFixed(2) + '%';

// --- Renderers ---
function renderActiveView() {
    if(activeTab === 'summary') renderSummaryTable();
    else if(activeTab === 'loss_tree') renderLossTree();
    else if(activeTab === 'ds_level') renderDSLevel();
    else if(activeTab === 'trend') renderTrend();
}

function renderSummaryTable() {
    const data = filterData(DB[activeDomain].SH);
    const grouped = {};
    data.forEach(row => {
        const zone = getValSafe(row, 'zone') || 'Unknown';
        const sh = getValSafe(row, 'SH_P0') || 'Unknown';
        const key = `${zone} | ${sh}`;
        if(!grouped[key]) grouped[key] = [];
        grouped[key].push(row);
    });

    let html = `<table><thead><tr>
        <th>Zone | SH_P0</th> <th>ATP_SH</th> <th>DS_ATP</th> <th>Open_PO</th> 
        <th>SH Instock %</th> <th>SH Instock+Schd %</th> <th>SH Instock+PO %</th>
        <th>SH MSTN %</th> <th>SH MSTN_SH-SH</th> <th>SH MSTN_NL-SH</th> <th>SH MSTN_PO</th>
        <th>DS Instock %</th> <th>DS Instock+IT %</th> <th>DS MSTN %</th> <th>IRN(d-1)</th> <th>SH_DS_IWIT</th>
    </tr></thead><tbody>`;

    Object.keys(grouped).sort().forEach(groupKey => {
        const rows = grouped[groupKey];
        const cnt = rows.length || 1;
        const sh_norm_sum = safeSum(rows, 'sh_norm') || 1;
        const ds_master_cnt = safeSum(rows, 'ds_master_count') || 1;
        const ds_norm_master = safeSum(rows, 'ds_norm_master') || 1;
        
        let sh_mstn_val = safeSum(rows, 'sh_mstn_atp') / sh_norm_sum;
        if(sh_mstn_val > 1) sh_mstn_val = 1;

        html += `<tr>
            <td><strong>${groupKey}</strong></td>
            <td>${safeSum(rows, 'atp_sh')}</td>
            <td>${safeSum(rows, 'ds_atp')}</td>
            <td>${safeSum(rows, 'open_po_qty')}</td>
            <td>${formatPct(safeSum(rows, 'atp_doh_flag') / cnt)}</td>
            <td>${formatPct(safeSum(rows, 'atp_sched_doh_flag') / cnt)}</td>
            <td>${formatPct(safeSum(rows, 'atp_po_doh_flag') / cnt)}</td>
            <td>${formatPct(sh_mstn_val)}</td>
            <td>${formatPct(safeSum(rows, 'sh_mstn_sh_sh') / sh_norm_sum)}</td>
            <td>${formatPct(safeSum(rows, 'sh_mstn_nl_sh') / sh_norm_sum)}</td>
            <td>${formatPct(safeSum(rows, 'sh_mstn_po') / sh_norm_sum)}</td>
            <td>${formatPct(safeSum(rows, 'ds_instock_count') / ds_master_cnt)}</td>
            <td>${formatPct(safeSum(rows, 'ds_instock_iwit_count') / ds_master_cnt)}</td>
            <td>${formatPct(safeSum(rows, 'ds_mstn_master') / ds_norm_master)}</td>
            <td>${safeSum(rows, 'IRN')}</td>
            <td>${safeSum(rows, 'sh_ds_iwit')}</td>
        </tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById('content-summary').innerHTML = html;
}

function renderLossTree() {
    const data = filterData(DB[activeDomain].SH);
    const allRemarks = [...new Set(data.map(r => getValSafe(r, 'remark')).filter(v => v))].sort();
    const grouped = {};
    
    data.forEach(row => {
        let key = 'Unknown';
        if(activeLossTreeGroup === 'zone_sh') key = (getValSafe(row, 'zone')||'') + ' | ' + (getValSafe(row, 'SH_P0')||'');
        else if(activeLossTreeGroup === 'fsn_level') key = (getValSafe(row, 'fsn')||'') + ' - ' + (getValSafe(row, 'title')||'');
        else key = getValSafe(row, activeLossTreeGroup) || 'Unknown';
        
        if(!grouped[key]) {
            grouped[key] = { total: 0, remarks: {} };
            allRemarks.forEach(rmk => grouped[key].remarks[rmk] = 0);
        }
        grouped[key].total++;
        const rmk = getValSafe(row, 'remark');
        if(rmk) grouped[key].remarks[rmk]++;
    });

    let html = `<table><thead><tr><th>${activeLossTreeGroup.toUpperCase()}</th><th>Total Rows</th>`;
    allRemarks.forEach(rmk => html += `<th>${rmk} %</th>`);
    html += `</tr></thead><tbody>`;

    Object.keys(grouped).sort().forEach(g => {
        const { total, remarks } = grouped[g];
        html += `<tr><td>${g}</td><td>${total}</td>`;
        allRemarks.forEach(rmk => {
            const pct = total > 0 ? ((remarks[rmk] / total) * 100).toFixed(1) : 0;
            html += `<td>${pct}%</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById('loss-tree-table-container').innerHTML = html;
}

function renderDSLevel() {
    const data = filterData(DB[activeDomain].DS, true); 
    const allRemarks = [...new Set(data.map(r => getValSafe(r, 'final_remark')).filter(v => v))].sort();
    const grouped = {};
    
    data.forEach(row => {
        const key = getValSafe(row, 'business_zone') || 'Unknown';
        if(!grouped[key]) {
            grouped[key] = { total: 0, remarks: {} };
            allRemarks.forEach(rmk => grouped[key].remarks[rmk] = 0);
        }
        grouped[key].total++;
        const rmk = getValSafe(row, 'final_remark');
        if(rmk) grouped[key].remarks[rmk]++;
    });

    let html = `<table><thead><tr><th>Business Zone (DS)</th><th>Total Rows</th>`;
    allRemarks.forEach(rmk => html += `<th>${rmk} %</th>`);
    html += `</tr></thead><tbody>`;

    Object.keys(grouped).sort().forEach(g => {
        const { total, remarks } = grouped[g];
        html += `<tr><td>${g}</td><td>${total}</td>`;
        allRemarks.forEach(rmk => {
            const pct = total > 0 ? ((remarks[rmk] / total) * 100).toFixed(1) : 0;
            html += `<td>${pct}%</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById('ds-level-table-container').innerHTML = html;
}

function renderTrend() {
    const data = filterData(DB[activeDomain].DOD);
    const grouped = {};
    
    data.forEach(row => {
        const date = getValSafe(row, 'report_date');
        if(!date) return;
        if(!grouped[date]) grouped[date] = [];
        grouped[date].push(row);
    });

    const dates = Object.keys(grouped).sort();
    const shDataPoints = [];
    const dsDataPoints = [];

    dates.forEach(date => {
        const rows = grouped[date];
        const cnt = rows.length || 1;
        
        if(activeTrendSub === 'mstn') {
            const sh_norm_sum = safeSum(rows, 'sh_norm') || 1;
            const ds_norm_sum = safeSum(rows, 'ds_norm_master') || 1;
            
            let sh_mstn = safeSum(rows, 'sh_mstn_atp') / sh_norm_sum;
            let ds_mstn = safeSum(rows, 'ds_mstn_master') / ds_norm_sum;
            
            shDataPoints.push(Math.min(sh_mstn * 100, 100).toFixed(2));
            dsDataPoints.push(Math.min(ds_mstn * 100, 100).toFixed(2));
        } else {
            const ds_master_cnt = safeSum(rows, 'ds_master_count') || 1;
            let sh_in = safeSum(rows, 'atp_doh_flag') / cnt;
            let ds_in = safeSum(rows, 'ds_instock_count') / ds_master_cnt;
            
            shDataPoints.push((sh_in * 100).toFixed(2));
            dsDataPoints.push((ds_in * 100).toFixed(2));
        }
    });

    const ctx = document.getElementById('trendChart').getContext('2d');
    if(chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                { label: `SH ${activeTrendSub.toUpperCase()} %`, data: shDataPoints, borderColor: '#2874f0', backgroundColor: '#2874f0', tension: 0.1 },
                { label: `DS ${activeTrendSub.toUpperCase()} %`, data: dsDataPoints, borderColor: '#ff9f00', backgroundColor: '#ff9f00', tension: 0.1 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { min: 0, max: 100, title: { display: true, text: 'Percentage (%)' } } }
        }
    });
}
