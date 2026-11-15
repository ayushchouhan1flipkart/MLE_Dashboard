let DB = { ELE: { SH: [], DS: [], DOD: [] }, SHA: { SH: [], DS: [], DOD: [] } };
let activeDomain = 'ELE';
let activeTab = 'summary';
let activeLossTreeGroup = 'zone_sh';
let activeTrendSub = 'mstn';
let chartInstance = null;
let currentProgress = 0;

const globalFilterKeys = ['master', 'final_fc', 'bu', 'sc', 'analytical_vertical', 'brand', 'remark', 'fsn', 'title', 'sh_p0', 'zone'];
const dsFilterKeys = ['current_flag', 'abhi_flag', 'common_flag', 'common_all_flag', 'new_all_flag', 'updated_flag', 'next2500_flag_new', 'business_zone'];
let currentFilters = {};

// --- Initialization & Data Fetching ---

$(document).ready(function() {
    // Fake progress bar for visual feedback
    let progressTimer = setInterval(() => {
        if (currentProgress < 85) {
            currentProgress += Math.floor(Math.random() * 5) + 1;
            $('#loader-percent').text(currentProgress + '%');
        }
    }, 300);

    // Call Google Apps Script Backend
    google.script.run
        .withSuccessHandler(function(payload) {
            clearInterval(progressTimer);
            $('#loader-percent').text('90%');
            processDriveData(payload);
        })
        .withFailureHandler(function(err) {
            alert('Error fetching files from Drive: ' + err.message);
            $('#loader-overlay').hide();
        })
        .getDashboardData();
});

function processDriveData(payload) {
    const parseOpts = { header: true, skipEmptyLines: true, dynamicTyping: true };
    
    if (payload['loss_tree_ds_detail_ele.csv']) DB.ELE.DS = Papa.parse(payload['loss_tree_ds_detail_ele.csv'], parseOpts).data;
    if (payload['loss_tree_sh_detail_ele.csv']) DB.ELE.SH = Papa.parse(payload['loss_tree_sh_detail_ele.csv'], parseOpts).data;
    if (payload['dod_ele_sh.csv']) DB.ELE.DOD = Papa.parse(payload['dod_ele_sh.csv'], parseOpts).data;
    
    if (payload['loss_tree_ds_detail_sha.csv']) DB.SHA.DS = Papa.parse(payload['loss_tree_ds_detail_sha.csv'], parseOpts).data;
    if (payload['loss_tree_sh_detail_sha.csv']) DB.SHA.SH = Papa.parse(payload['loss_tree_sh_detail_sha.csv'], parseOpts).data;
    if (payload['dod_sha_sh.csv']) DB.SHA.DOD = Papa.parse(payload['dod_sha_sh.csv'], parseOpts).data;

    $('#loader-percent').text('100%');
    setTimeout(() => { $('#loader-overlay').fadeOut(400); }, 300);
    
    populateFilters();
    renderActiveView();
}

// --- UI Navigation ---

function switchDomain(domain) {
    activeDomain = domain;
    populateFilters();
    renderActiveView();
}

function switchTab(tabName) {
    activeTab = tabName;
    $('.tab-content-area').addClass('d-none');
    $('#content-' + tabName).removeClass('d-none');
    
    if(tabName === 'ds_level') {
        $('#ds-filters-container').removeClass('d-none');
    } else {
        $('#ds-filters-container').addClass('d-none');
    }
    renderActiveView();
}

function switchLossTreeGroup(group, elem) {
    activeLossTreeGroup = group;
    $(elem).closest('.nav-tabs').find('.nav-link').removeClass('active');
    $(elem).addClass('active');
    renderActiveView();
}

function switchTrendSub(sub, elem) {
    activeTrendSub = sub;
    $(elem).closest('.nav-tabs').find('.nav-link').removeClass('active');
    $(elem).addClass('active');
    renderActiveView();
}

function toggleFullScreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else if (document.exitFullscreen) document.exitFullscreen();
}

// --- Data & Filters ---

function getValSafe(row, key) {
    const lowerKey = key.toLowerCase();
    const actualKey = Object.keys(row).find(k => k.toLowerCase() === lowerKey);
    return actualKey ? row[actualKey] : undefined;
}

function populateFilters() {
    const createSelect = (key, dataSrc) => {
        const uniqueVals = [...new Set(dataSrc.map(row => getValSafe(row, key)).filter(v => v !== undefined && v !== ''))].sort();
        let html = `<div class="col-md-2"><label>${key.replace(/_/g, ' ')}</label><select id="filter_${key}" class="form-control select2" multiple>`;
        uniqueVals.forEach(v => html += `<option value="${v}">${v}</option>`);
        html += `</select></div>`;
        return html;
    };

    const shData = DB[activeDomain].SH || [];
    const dsData = DB[activeDomain].DS || [];

    let gHtml = '';
    globalFilterKeys.forEach(k => { gHtml += createSelect(k, shData); });
    $('#global-filters-container').html(gHtml);

    let dsHtml = '';
    dsFilterKeys.forEach(k => {
        if (dsData.length > 0 && Object.keys(dsData[0]).some(c => c.toLowerCase() === k.toLowerCase())) {
            dsHtml += createSelect(k, dsData);
        }
    });
    $('#exclusive-ds-filters-container').html(dsHtml);

    $('.select2').select2({ placeholder: 'All', width: '100%' });
}

function applyFilters() {
    currentFilters = {};
    globalFilterKeys.forEach(k => {
        const vals = $(`#filter_${k}`).val();
        if(vals && vals.length > 0) currentFilters[k] = vals;
    });
    dsFilterKeys.forEach(k => {
        const vals = $(`#filter_${k}`).val();
        if(vals && vals.length > 0) currentFilters[k] = vals;
    });
    renderActiveView();
}

function filterData(data, includeDS = false) {
    return data.filter(row => {
        for (const key in currentFilters) {
            if(!includeDS && dsFilterKeys.includes(key)) continue;
            const rowVal = String(getValSafe(row, key));
            const selectedVals = currentFilters[key];
            if (rowVal !== 'undefined' && selectedVals && selectedVals.length > 0) {
                if(!selectedVals.includes(rowVal)) return false;
            }
        }
        return true;
    });
}

function safeSum(arr, key) {
    return arr.reduce((sum, row) => sum + (Number(getValSafe(row, key)) || 0), 0);
}

// --- DataTables Rendering ---

const dtConfigBase = {
    deferRender: true, destroy: true, scrollX: true, scrollY: '55vh', scrollCollapse: true, 
    paging: true, pageLength: 50, lengthMenu: [10, 50, 100, 250, 500],
    autoWidth: false,
    fixedColumns: { left: 1 } // Keeps the first column sticky
};

// Styling for percentage cells (matches reference exactly)
function applyColorCoding(td, cellData, rowData) {
    let pct = parseFloat(cellData); 
    if (isNaN(pct)) return;
    td.style.setProperty('box-shadow', 'none', 'important'); 
    if (pct < 60) { 
        td.style.setProperty('background-color', '#fee2e2', 'important'); 
        td.style.setProperty('color', '#b91c1c', 'important'); 
    } else if (pct < 80) { 
        td.style.setProperty('background-color', '#fef08a', 'important'); 
        td.style.setProperty('color', '#854d0e', 'important'); 
    } else { 
        td.style.setProperty('background-color', '#dcfce7', 'important'); 
        td.style.setProperty('color', '#15803d', 'important'); 
    }
}

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

    const tableData = [];
    Object.keys(grouped).sort().forEach(groupKey => {
        const rows = grouped[groupKey];
        const cnt = rows.length || 1;
        const sh_norm_sum = safeSum(rows, 'sh_norm') || 1;
        const ds_master_cnt = safeSum(rows, 'ds_master_count') || 1;
        const ds_norm_master = safeSum(rows, 'ds_norm_master') || 1;
        let sh_mstn_val = safeSum(rows, 'sh_mstn_atp') / sh_norm_sum;
        if(sh_mstn_val > 1) sh_mstn_val = 1;

        tableData.push({
            group: groupKey,
            atp_sh: safeSum(rows, 'atp_sh'), ds_atp: safeSum(rows, 'ds_atp'), open_po: safeSum(rows, 'open_po_qty'),
            sh_instock: (safeSum(rows, 'atp_doh_flag') / cnt) * 100,
            sh_instock_schd: (safeSum(rows, 'atp_sched_doh_flag') / cnt) * 100,
            sh_instock_po: (safeSum(rows, 'atp_po_doh_flag') / cnt) * 100,
            sh_mstn: sh_mstn_val * 100,
            sh_mstn_sh_sh: (safeSum(rows, 'sh_mstn_sh_sh') / sh_norm_sum) * 100,
            sh_mstn_nl_sh: (safeSum(rows, 'sh_mstn_nl_sh') / sh_norm_sum) * 100,
            sh_mstn_po: (safeSum(rows, 'sh_mstn_po') / sh_norm_sum) * 100,
            ds_instock: (safeSum(rows, 'ds_instock_count') / ds_master_cnt) * 100,
            ds_instock_it: (safeSum(rows, 'ds_instock_iwit_count') / ds_master_cnt) * 100,
            ds_mstn: (safeSum(rows, 'ds_mstn_master') / ds_norm_master) * 100,
            irn: safeSum(rows, 'IRN'),
            iwit: safeSum(rows, 'sh_ds_iwit')
        });
    });

    const columns = [
        { title: "Zone | SH_P0", data: "group" },
        { title: "ATP SH", data: "atp_sh" },
        { title: "DS ATP", data: "ds_atp" },
        { title: "Open PO", data: "open_po" },
        { title: "SH Instock %", data: "sh_instock", render: $.fn.dataTable.render.number(',', '.', 1, '', '%'), createdCell: applyColorCoding },
        { title: "SH (+Sch) %", data: "sh_instock_schd", render: $.fn.dataTable.render.number(',', '.', 1, '', '%'), createdCell: applyColorCoding },
        { title: "SH (+PO) %", data: "sh_instock_po", render: $.fn.dataTable.render.number(',', '.', 1, '', '%'), createdCell: applyColorCoding },
        { title: "SH MSTN %", data: "sh_mstn", className: 'section-divider', render: $.fn.dataTable.render.number(',', '.', 1, '', '%'), createdCell: applyColorCoding },
        { title: "SH MSTN (SH-SH)", data: "sh_mstn_sh_sh", render: $.fn.dataTable.render.number(',', '.', 1, '', '%') },
        { title: "SH MSTN (NL-SH)", data: "sh_mstn_nl_sh", render: $.fn.dataTable.render.number(',', '.', 1, '', '%') },
        { title: "SH MSTN (PO)", data: "sh_mstn_po", render: $.fn.dataTable.render.number(',', '.', 1, '', '%') },
        { title: "DS Instock %", data: "ds_instock", className: 'section-divider', render: $.fn.dataTable.render.number(',', '.', 1, '', '%'), createdCell: applyColorCoding },
        { title: "DS Instock (+IT) %", data: "ds_instock_it", render: $.fn.dataTable.render.number(',', '.', 1, '', '%'), createdCell: applyColorCoding },
        { title: "DS MSTN %", data: "ds_mstn", render: $.fn.dataTable.render.number(',', '.', 1, '', '%'), createdCell: applyColorCoding },
        { title: "IRN (d-1)", data: "irn", className: 'section-divider' },
        { title: "SH DS IWIT", data: "iwit" }
    ];

    $('#dt-summary').DataTable({ ...dtConfigBase, data: tableData, columns: columns });
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
            grouped[key] = { group: key, total: 0 };
            allRemarks.forEach(rmk => grouped[key][rmk] = 0);
        }
        grouped[key].total++;
        const rmk = getValSafe(row, 'remark');
        if(rmk) grouped[key][rmk]++;
    });

    const tableData = [];
    Object.keys(grouped).sort().forEach(g => {
        const row = grouped[g];
        allRemarks.forEach(rmk => {
            row[rmk + '_pct'] = row.total > 0 ? (row[rmk] / row.total) * 100 : 0;
        });
        tableData.push(row);
    });

    const columns = [
        { title: activeLossTreeGroup.toUpperCase().replace(/_/g, ' '), data: "group" },
        { title: "Total Rows", data: "total" }
    ];
    allRemarks.forEach(rmk => {
        columns.push({ 
            title: rmk + " %", 
            data: rmk + "_pct", 
            render: $.fn.dataTable.render.number(',', '.', 1, '', '%'),
            createdCell: function(td, cellData) {
                if (cellData > 15) { td.style.color = '#b91c1c'; td.style.fontWeight = '700'; }
            }
        });
    });

    $('#dt-loss-tree').DataTable({ ...dtConfigBase, data: tableData, columns: columns });
}

function renderDSLevel() {
    const data = filterData(DB[activeDomain].DS, true); 
    const allRemarks = [...new Set(data.map(r => getValSafe(r, 'final_remark')).filter(v => v))].sort();
    const grouped = {};
    
    data.forEach(row => {
        const key = getValSafe(row, 'business_zone') || 'Unknown';
        if(!grouped[key]) {
            grouped[key] = { group: key, total: 0 };
            allRemarks.forEach(rmk => grouped[key][rmk] = 0);
        }
        grouped[key].total++;
        const rmk = getValSafe(row, 'final_remark');
        if(rmk) grouped[key][rmk]++;
    });

    const tableData = [];
    Object.keys(grouped).sort().forEach(g => {
        const row = grouped[g];
        allRemarks.forEach(rmk => {
            row[rmk + '_pct'] = row.total > 0 ? (row[rmk] / row.total) * 100 : 0;
        });
        tableData.push(row);
    });

    const columns = [
        { title: "Business Zone (DS)", data: "group" },
        { title: "Total Rows", data: "total" }
    ];
    allRemarks.forEach(rmk => {
        columns.push({ 
            title: rmk + " %", 
            data: rmk + "_pct", 
            render: $.fn.dataTable.render.number(',', '.', 1, '', '%'),
            createdCell: function(td, cellData) {
                if (cellData > 15) { td.style.color = '#b91c1c'; td.style.fontWeight = '700'; }
            }
        });
    });

    $('#dt-ds-level').DataTable({ ...dtConfigBase, data: tableData, columns: columns });
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
                { label: `SH ${activeTrendSub.toUpperCase()} %`, data: shDataPoints, borderColor: '#E31837', backgroundColor: '#E31837', tension: 0.1 },
                { label: `DS ${activeTrendSub.toUpperCase()} %`, data: dsDataPoints, borderColor: '#0f172a', backgroundColor: '#0f172a', tension: 0.1 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { min: 0, max: 100, title: { display: true, text: 'Percentage (%)' } } }
        }
    });
}
