const CORS_PROXY = 'https://corsproxy.io/?';
const STORAGE_KEY = 'infoEtfState';
let currentResult = null;
const fxRateCache = { EUR: 1 };
const filterState = {
    code: '',
    name: '',
    price: '',
    priceEur: '',
    changePct: ''
};
const sortState = {
    key: 'order',
    direction: 'asc'
};

async function searchISIN() {
    const inputCode = document.getElementById('isin').value.trim().toUpperCase();
    const btn = document.getElementById('searchBtn');

    hideAll();

    if (!inputCode) {
        showError('Inserisci un codice ISIN.');
        return;
    }

    const isISIN = /^[A-Z0-9]{11}$/.test(inputCode);
    if (!isISIN) {
        showError('Il codice ISIN non e valido. Deve contenere 11 caratteri alfanumerici (es. 0378331005A).');
        return;
    }

    const codeType = 'ISIN';
    showSpinner(true);
    btn.disabled = true;

    try {
        const searchUrl = `${CORS_PROXY}${`https://query1.finance.yahoo.com/v1/finance/search?q=${inputCode}&quotesCount=1&newsCount=0`}`;
        const searchResp = await fetch(searchUrl,{cache: 'no-store'},{cache: 'no-store'});
        if (!searchResp.ok) throw new Error('Errore nella ricerca del titolo.');

        const searchData = await searchResp.json();
        const quotes = searchData?.quotes;
        if (!quotes || quotes.length === 0) {
            throw new Error(`Nessun titolo trovato per l\'ISIN <strong>${inputCode}</strong>. Verifica che il codice sia corretto.`);
        }

        const symbol = quotes[0].symbol;
        const longName = quotes[0].longname || quotes[0].shortname || symbol;

        const quoteUrl = `${CORS_PROXY}${`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`}`;
        const quoteResp = await fetch(quoteUrl,{cache: 'no-store'});
        if (!quoteResp.ok) throw new Error('Errore nel recupero della quotazione.');

        const quoteData = await quoteResp.json();
        const meta = quoteData?.chart?.result?.[0]?.meta;
        if (!meta) throw new Error('Dati di quotazione non disponibili.');

        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || meta.previousClose;
        const currency = meta.currency || '';
        const open = meta.regularMarketOpen ?? '-';
        const high = meta.regularMarketDayHigh ?? '-';
        const low = meta.regularMarketDayLow ?? '-';
        const volume = meta.regularMarketVolume;
        const exchange = meta.exchangeName || meta.fullExchangeName || '-';
        const change = (price ?? 0) - (prevClose ?? 0);
        const changePct = prevClose ? ((change / prevClose) * 100) : null;

        currentResult = {
            timestamp: new Date().toISOString(),
            isin: inputCode,
            symbol,
            longName,
            price,
            prevClose,
            currency,
            open,
            high,
            low,
            volume,
            exchange,
            change,
            changePct
        };

        document.getElementById('cardName').textContent = longName;
        document.getElementById('cardISIN').textContent = `${codeType}: ${inputCode}  |  Simbolo: ${symbol}`;
        document.getElementById('cardPrice').textContent = formatNum(price, 4);
        document.getElementById('cardCurrency').textContent = currency;

        const changeEl = document.getElementById('cardChange');
        const sign = change >= 0 ? '+' : '';
        const pctText = changePct === null ? '-' : `${sign}${changePct.toFixed(2)}%`;
        changeEl.textContent = `${sign}${formatNum(change, 4)} (${pctText})`;
        changeEl.className = 'change ' + (change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral');

        document.getElementById('cardOpen').textContent = open !== '-' ? formatNum(open, 4) : '-';
        document.getElementById('cardPrevClose').textContent = prevClose ? formatNum(prevClose, 4) : '-';
        document.getElementById('cardHigh').textContent = high !== '-' ? formatNum(high, 4) : '-';
        document.getElementById('cardLow').textContent = low !== '-' ? formatNum(low, 4) : '-';
        document.getElementById('cardVolume').textContent = volume ? parseInt(volume, 10).toLocaleString('it-IT') : '-';
        document.getElementById('cardExchange').textContent = exchange;

        document.getElementById('card').classList.add('visible');
        document.getElementById('addToTableBtn').disabled = false;
    } catch (err) {
        currentResult = null;
        document.getElementById('addToTableBtn').disabled = true;
        showError(err.message || 'Errore sconosciuto.');
    } finally {
        showSpinner(false);
        btn.disabled = false;
    }
}

function addCurrentResultToTable() {
    if (!currentResult) return;
    const records = getSavedRecords();
    const alreadyExists = records.some(r => (r.isin || '').toUpperCase() === (currentResult.isin || '').toUpperCase());
    if (alreadyExists) {
        showError(`Codice ${currentResult.isin} gia presente in tabella.`);
        return;
    }
    persistCurrentResult(records);
}

async function persistCurrentResult(records) {
    const priceEur = await getPriceInEur(currentResult.price, currentResult.currency);
    // Assign order as the next available position
    const maxOrder = records.reduce((max, r) => Math.max(max, r.order || 0), -1);
    records.push({
        ...currentResult,
        priceEur,
        order: maxOrder + 1
    });
    saveRecords(records);
    renderSavedTable(records);
    document.getElementById('errorBox').classList.remove('visible');
}

function getSavedRecords() {
    return getAppState().records;
}

function saveRecords(records) {
    const state = getAppState();
    state.records = Array.isArray(records) ? records : [];
    saveAppState(state);
}

let draggedRecordIndex = null;
let currentPopupRecord = null;

function renderSavedTable(records) {
    const tbody = document.getElementById('savedTableBody');
    tbody.innerHTML = '';
    const displayRecords = getDisplayRecords(records);

    if (!displayRecords.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 8;
        td.textContent = 'Nessun record salvato.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    displayRecords.forEach((record, index) => {
        const tr = document.createElement('tr');
        tr.draggable = true;
        tr.dataset.index = index;
        tr.dataset.timestamp = record.timestamp;
        tr.addEventListener('dragstart', handleDragStart);
        tr.addEventListener('dragover', handleDragOver);
        tr.addEventListener('drop', handleDrop);
        tr.addEventListener('dragend', handleDragEnd);
        tr.addEventListener('click', () => showPopup(record));
        const pctText = Number.isFinite(record.changePct) ? `${record.changePct.toFixed(2)} %` : '-';
        const pctClass = record.changePct > 0 ? 'positive' : record.changePct < 0 ? 'negative' : 'neutral';
        const lowHighText = record.low !== '-' && record.high !== '-' 
            ? `${formatNum(record.low, 4)} - ${formatNum(record.high, 4)}` 
            : '-';
        const pmcText = record.pmc ? formatNum(record.pmc, 4) + ' €' : '-';
        // Calculate % between PMC and current price
        let pctComplessiva = '-';
        if (record.pmc && record.priceEur) {
            const pct = ((record.priceEur * 100) / record.pmc) - 100;
            pctComplessiva = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)} %`;
        }
        tr.innerHTML = `
            <td class="row-num" title="Trascina per riordinare">${index + 1}</td>
            <td>${record.isin || '-'}</td>
            <td>${record.longName || '-'}</td>
            <td>${pmcText}</td>
            <td>${formatNum(record.priceEur, 2)} €</td>
            <td class="${pctClass}">${pctText}</td>
            <td class="${pctComplessiva.startsWith('+') ? 'positive' : pctComplessiva.startsWith('-') ? 'negative' : 'neutral'}">${pctComplessiva}</td>
            <td>${lowHighText}</td>
        `;
        tbody.appendChild(tr);
    });
}

function handleDragStart(e) {
    draggedRecordIndex = parseInt(this.dataset.index, 10);
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e) {
    e.preventDefault();
    const targetIndex = parseInt(this.dataset.index, 10);
    if (draggedRecordIndex !== null && draggedRecordIndex !== targetIndex) {
        const records = getSavedRecords();
        const displayRecords = getDisplayRecords(records);
        const movedRecord = displayRecords[draggedRecordIndex];
        const targetRecord = displayRecords[targetIndex];
        
        // Find the actual records in the original records array
        const movedTimestamp = movedRecord.timestamp;
        const targetTimestamp = targetRecord.timestamp;
        
        // Reorder: move dragged record to target position and update all order values
        const movedIdx = records.findIndex(r => r.timestamp === movedTimestamp);
        const targetIdx = records.findIndex(r => r.timestamp === targetTimestamp);
        
        if (movedIdx !== -1 && targetIdx !== -1) {
            // Remove from old position
            const [removed] = records.splice(movedIdx, 1);
            // Insert at new position
            const newTargetIdx = records.findIndex(r => r.timestamp === targetTimestamp);
            records.splice(newTargetIdx >= 0 ? newTargetIdx : records.length, 0, removed);
            
            // Update all order values based on new positions
            records.forEach((r, idx) => {
                r.order = idx;
            });
            
            saveRecords(records);
            renderSavedTable(records);
        }
    }
}

function handleDragEnd() {
    this.classList.remove('dragging');
    draggedRecordIndex = null;
}

function getDisplayRecords(records) {
    const filtered = records.filter(record => {
        const codeValue = (record.isin || '-').toLowerCase();
        const nameValue = (record.longName || '').toLowerCase();
        const priceValue = `${formatNum(record.price, 4)} ${record.currency || ''}`.toLowerCase();
        const priceEurValue = formatNum(record.priceEur, 4).toLowerCase();
        const changeValue = (Number.isFinite(record.changePct) ? `${record.changePct.toFixed(2)}%` : '-').toLowerCase();

        return codeValue.includes(filterState.code)
            && nameValue.includes(filterState.name)
            && priceValue.includes(filterState.price)
            && priceEurValue.includes(filterState.priceEur)
            && changeValue.includes(filterState.changePct);
    });

    filtered.sort((a, b) => compareBySortKey(a, b));
    return filtered;
}

function compareBySortKey(a, b) {
    let av;
    let bv;
    switch (sortState.key) {
        case 'order':
            av = Number(a.order) ?? 0;
            bv = Number(b.order) ?? 0;
            break;
        case 'code':
            av = (a.isin || '').toUpperCase();
            bv = (b.isin || '').toUpperCase();
            break;
        case 'name':
            av = (a.longName || '').toUpperCase();
            bv = (b.longName || '').toUpperCase();
            break;
        case 'price':
            av = Number(a.price) || 0;
            bv = Number(b.price) || 0;
            break;
        case 'priceEur':
            av = Number(a.priceEur) || 0;
            bv = Number(b.priceEur) || 0;
            break;
        case 'changePct':
            av = Number(a.changePct) || 0;
            bv = Number(b.changePct) || 0;
            break;
        case 'rowNo':
        default:
            av = new Date(a.timestamp).getTime();
            bv = new Date(b.timestamp).getTime();
            break;
    }

    if (av < bv) return sortState.direction === 'asc' ? -1 : 1;
    if (av > bv) return sortState.direction === 'asc' ? 1 : -1;
    return 0;
}

function setSort(key) {
    if (sortState.key === key) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.key = key;
        sortState.direction = 'asc';
    }
    renderSavedTable(getSavedRecords());
}

function bindFilters() {
    const map = [
        ['filterCode', 'code'],
        ['filterName', 'name']
    ];

    map.forEach(([id, key]) => {
        const el = document.getElementById(id);
        el.addEventListener('input', () => {
            filterState[key] = el.value.trim().toLowerCase();
            renderSavedTable(getSavedRecords());
        });
    });
}

function removeRecordByTimestamp(timestamp) {
    const records = getSavedRecords().filter(r => r.timestamp !== timestamp);
    saveRecords(records);
    renderSavedTable(records);
}

async function refreshSavedRecords() {
    const refreshBtn = document.getElementById('refreshTableBtn');
    const records = getSavedRecords();

    if (!records.length) {
        showError('Nessun record da aggiornare.');
        return;
    }

    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Aggiornamento...';
    showSpinner(true);

    let updatedCount = 0;
    let skippedCount = 0;

    try {
        for (const record of records) {
            if (!record.symbol) {
                skippedCount += 1;
                continue;
            }

            try {
                const quoteUrl = `${CORS_PROXY}${`https://query1.finance.yahoo.com/v8/finance/chart/${record.symbol}?interval=1d&range=1d`}`;
                const quoteResp = await fetch(quoteUrl,{cache: 'no-store'});
                if (!quoteResp.ok) throw new Error('Quote request failed');

                const quoteData = await quoteResp.json();
                const meta = quoteData?.chart?.result?.[0]?.meta;
                if (!meta) throw new Error('Quote meta missing');

                const price = meta.regularMarketPrice;
                const prevClose = meta.chartPreviousClose || meta.previousClose;
                const open = meta.regularMarketOpen ?? '-';
                const high = meta.regularMarketDayHigh ?? '-';
                const low = meta.regularMarketDayLow ?? '-';
                const volume = meta.regularMarketVolume;
                const currency = meta.currency || record.currency || '';
                const exchange = meta.exchangeName || meta.fullExchangeName || record.exchange || '-';
                const longName = meta.longName || meta.shortName || record.longName || record.symbol;
                const change = (price ?? 0) - (prevClose ?? 0);
                const changePct = prevClose ? ((change / prevClose) * 100) : null;

                record.price = price;
                record.prevClose = prevClose;
                record.open = open;
                record.high = high;
                record.low = low;
                record.volume = volume;
                record.currency = currency;
                record.exchange = exchange;
                record.longName = longName;
                record.change = change;
                record.changePct = changePct;
                record.priceEur = await getPriceInEur(price, currency);
                record.timestamp = new Date().toISOString();
                updatedCount += 1;
            } catch (_) {
                skippedCount += 1;
            }
        }

        saveRecords(records);
        
        // Save last update timestamp
        const now = new Date();
        filterState.lastUpdate = now.toISOString();
        updateLastUpdateLabel(now);
        
        renderSavedTable(records);

        // No message shown after refresh
    } finally {
        showSpinner(false);
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh tabella';
    }
}

async function getPriceInEur(price, currency) {
    if (!Number.isFinite(Number(price))) return null;
    const ccy = (currency || '').toUpperCase();
    if (!ccy) return null;
    if (ccy === 'EUR') return Number(price);

    let rate = fxRateCache[ccy];
    if (!rate) {
        try {
            const fxUrl = `https://api.frankfurter.app/latest?from=${(ccy)}&to=EUR`;
            const resp = await fetch(fxUrl,{cache: 'no-store'});
            if (!resp.ok) throw new Error('FX request failed');
            const data = await resp.json();
            const fetched = data?.rates?.EUR;
            rate = Number(fetched);
            if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid FX rate');
            fxRateCache[ccy] = rate;
        } catch (_) {
            return null;
        }
    }

    return Number(price) * rate;
}

function getAppState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { records: [] };
        const parsed = JSON.parse(raw);
        const records = Array.isArray(parsed.records) ? parsed.records : [];
        // Add order field to records that don't have it
        records.forEach((r, idx) => {
            if (r.order === undefined) {
                r.order = idx;
            }
        });
        return { records };
    } catch (_) {
        return { records: [] };
    }
}

function saveAppState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        records: Array.isArray(state.records) ? state.records : []
    }));
}

function formatNum(n, decimals) {
    if (n === undefined || n === null || n === '-') return '-';
    return parseFloat(n).toLocaleString('it-IT', {
        minimumFractionDigits: 2,
        maximumFractionDigits: decimals
    });
}

function hideAll() {
    document.getElementById('card').classList.remove('visible');
    document.getElementById('errorBox').classList.remove('visible');
}

function showPopup(record) {
    const popup = document.getElementById('detailPopup');
    document.getElementById('popupTitle').textContent = record.longName || record.symbol;
    
    // Store current record for PMC save
    currentPopupRecord = record;
    
    // Set PMC value
    document.getElementById('pmcInput').value = record.pmc || '';
    
    const body = document.getElementById('popupBody');
    const pctText = Number.isFinite(record.changePct) ? `${record.changePct >= 0 ? '+' : ''}${record.changePct.toFixed(2)}%` : '-';
    const priceText = `${formatNum(record.price, 4)} ${record.currency || ''}`.trim();
    
    body.innerHTML = `
        <div class="popup-row"><span class="popup-label">ISIN</span><span class="popup-value">${record.isin || '-'}</span></div>
        <div class="popup-row"><span class="popup-label">Simbolo</span><span class="popup-value">${record.symbol || '-'}</span></div>
        <div class="popup-row"><span class="popup-label">Prezzo</span><span class="popup-value">${priceText}</span></div>
        <div class="popup-row"><span class="popup-label">Prezzo EUR</span><span class="popup-value">${formatNum(record.priceEur, 4)}</span></div>
        <div class="popup-row"><span class="popup-label">% Giornaliera</span><span class="popup-value">${pctText}</span></div>
        <div class="popup-row"><span class="popup-label">Apertura</span><span class="popup-value">${record.open !== '-' ? formatNum(record.open, 4) : '-'}</span></div>
        <div class="popup-row"><span class="popup-label">Chiusura Prec.</span><span class="popup-value">${record.prevClose ? formatNum(record.prevClose, 4) : '-'}</span></div>
        <div class="popup-row"><span class="popup-label">Low</span><span class="popup-value">${record.low !== '-' ? formatNum(record.low, 4) : '-'}</span></div>
        <div class="popup-row"><span class="popup-label">High</span><span class="popup-value">${record.high !== '-' ? formatNum(record.high, 4) : '-'}</span></div>
        <div class="popup-row"><span class="popup-label">Volume</span><span class="popup-value">${record.volume ? parseInt(record.volume, 10).toLocaleString('it-IT') : '-'}</span></div>
        <div class="popup-row"><span class="popup-label">Mercato</span><span class="popup-value">${record.exchange || '-'}</span></div>
        <div class="popup-row"><span class="popup-label">Valuta</span><span class="popup-value">${record.currency || '-'}</span></div>
    `;
    
    popup.classList.add('visible');
}

function closePopup() {
    document.getElementById('detailPopup').classList.remove('visible');
}

// Close popup on overlay click
document.getElementById('detailPopup').addEventListener('click', function(e) {
    if (e.target === this) closePopup();
});

function savePmc() {
    if (!currentPopupRecord) return;
    
    const pmcValue = document.getElementById('pmcInput').value;
    const pmc = pmcValue ? parseFloat(pmcValue) : null;
    
    // Find and update the record in local storage
    const records = getSavedRecords();
    const recordIndex = records.findIndex(r => r.timestamp === currentPopupRecord.timestamp);
    
    if (recordIndex !== -1) {
        records[recordIndex].pmc = pmc;
        saveRecords(records);
        renderSavedTable(records);
    }
    
    closePopup();
}

function deleteRecordFromPopup() {
    if (!currentPopupRecord) return;
    
    const records = getSavedRecords().filter(r => r.timestamp !== currentPopupRecord.timestamp);
    saveRecords(records);
    renderSavedTable(records);
    closePopup();
}

function showSpinner(on) {
    document.getElementById('spinner').classList.toggle('active', on);
}

function showError(msg) {
    const box = document.getElementById('errorBox');
    box.innerHTML = '[!] ' + msg;
    box.classList.add('visible');
}

document.getElementById('isin').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchISIN();
});

document.getElementById('searchName').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchByName();
});

async function searchByName() {
    const inputName = document.getElementById('searchName').value.trim();
    const btn = document.getElementById('searchBtn');

    hideAll();

    if (!inputName) {
        showError('Inserisci un nome da cercare.');
        return;
    }

    showSpinner(true);
    btn.disabled = true;

    try {
        const searchUrl = `${CORS_PROXY}${`https://query1.finance.yahoo.com/v1/finance/search?q=${inputName}&quotesCount=10&newsCount=0`}`;
        const searchResp = await fetch(searchUrl,{cache: 'no-store'});
        if (!searchResp.ok) throw new Error('Errore nella ricerca del titolo.');

        const searchData = await searchResp.json();
        const quotes = searchData?.quotes;
        if (!quotes || quotes.length === 0) {
            throw new Error(`Nessun titolo trovato per <strong>${inputName}</strong>.`);
        }

        // Show first result
        const quote = quotes[0];
        const symbol = quote.symbol;
        const longName = quote.longname || quote.shortname || symbol;

        const quoteUrl = `${CORS_PROXY}${`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`}`;
        const quoteResp = await fetch(quoteUrl,{cache: 'no-store'});
        if (!quoteResp.ok) throw new Error('Errore nel recupero della quotazione.');

        const quoteData = await quoteResp.json();
        const meta = quoteData?.chart?.result?.[0]?.meta;
        if (!meta) throw new Error('Dati di quotazione non disponibili.');

        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || meta.previousClose;
        const currency = meta.currency || '';
        const open = meta.regularMarketOpen ?? '-';
        const high = meta.regularMarketDayHigh ?? '-';
        const low = meta.regularMarketDayLow ?? '-';
        const volume = meta.regularMarketVolume;
        const exchange = meta.exchangeName || meta.fullExchangeName || '-';
        const change = (price ?? 0) - (prevClose ?? 0);
        const changePct = prevClose ? ((change / prevClose) * 100) : null;

        currentResult = {
            timestamp: new Date().toISOString(),
            isin: '',
            symbol,
            longName,
            price,
            prevClose,
            currency,
            open,
            high,
            low,
            volume,
            exchange,
            change,
            changePct
        };

        document.getElementById('cardName').textContent = longName;
        document.getElementById('cardISIN').textContent = `Simbolo: ${symbol}  |  Mercato: ${exchange}`;
        document.getElementById('cardPrice').textContent = formatNum(price, 4);
        document.getElementById('cardCurrency').textContent = currency;

        const changeEl = document.getElementById('cardChange');
        const sign = change >= 0 ? '+' : '';
        const pctText = changePct === null ? '-' : `${sign}${changePct.toFixed(2)}%`;
        changeEl.textContent = `${sign}${formatNum(change, 4)} (${pctText})`;
        changeEl.className = 'change ' + (change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral');

        document.getElementById('cardOpen').textContent = open !== '-' ? formatNum(open, 4) : '-';
        document.getElementById('cardPrevClose').textContent = prevClose ? formatNum(prevClose, 4) : '-';
        document.getElementById('cardHigh').textContent = high !== '-' ? formatNum(high, 4) : '-';
        document.getElementById('cardLow').textContent = low !== '-' ? formatNum(low, 4) : '-';
        document.getElementById('cardVolume').textContent = volume ? parseInt(volume, 10).toLocaleString('it-IT') : '-';
        document.getElementById('cardExchange').textContent = exchange;

        document.getElementById('card').classList.add('visible');
        document.getElementById('addToTableBtn').disabled = false;
    } catch (err) {
        currentResult = null;
        document.getElementById('addToTableBtn').disabled = true;
        showError(err.message || 'Errore sconosciuto.');
    } finally {
        showSpinner(false);
        btn.disabled = false;
    }
}

bindFilters();

// Load last update timestamp and display
if (filterState.lastUpdate) {
    updateLastUpdateLabel(new Date(filterState.lastUpdate));
}

function updateLastUpdateLabel(date) {
    const label = document.getElementById('lastUpdateLabel');
    if (label) {
        const formatted = date.toLocaleString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        label.textContent = `Ultimo aggiornamento: ${formatted}`;
    }
}
renderSavedTable(getSavedRecords());
