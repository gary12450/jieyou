// 成員比對：選兩位成員，逐項看圖鑑項目誰有、誰沒有（依成員勾選的擁有項目）

function compareMembers() {
    const a = state.memberMap.get(state.compareA) || null;
    const b = state.memberMap.get(state.compareB) || null;
    return { a, b };
}

function compareMemberOptions(selectedId) {
    const sorted = state.members.slice().sort((x, y) => byText(x.gameName, y.gameName));
    return '<option value="">選擇成員</option>' + sorted.map(m =>
        `<option value="${esc(m.id)}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.gameName)}</option>`).join('');
}

function renderCompareFilters() {
    // 成員被刪掉就清掉選擇
    if (!state.memberMap.has(state.compareA)) state.compareA = '';
    if (!state.memberMap.has(state.compareB)) state.compareB = '';
    $('compare-a').innerHTML = compareMemberOptions(state.compareA);
    $('compare-b').innerHTML = compareMemberOptions(state.compareB);

    const sel = $('compare-cat');
    const keep = sel.value;
    const cats = categoriesInUse().filter(c => state.items.some(i => i.category === c));
    sel.innerHTML = '<option value="">全部類別</option>' + cats.map(c => `<option value="${esc(c)}">${categoryIcon(c)} ${esc(c)}</option>`).join('');
    sel.value = cats.includes(keep) ? keep : '';
}

const OWN_YES = '<span class="own yes">✔ 有</span>';
const OWN_NO = '<span class="own no">✘ 沒有</span>';

// 結果篩選：任一人有／兩人都有／只有其中一人有
const COMPARE_MODES = {
    any: (ha, hb) => ha || hb,
    both: (ha, hb) => ha && hb,
    onlyA: (ha, hb) => ha && !hb,
    onlyB: (ha, hb) => !ha && hb
};

function renderCompare() {
    const { a, b } = compareMembers();
    $('compare-head-a').textContent = a ? a.gameName : '成員一';
    $('compare-head-b').textContent = b ? b.gameName : '成員二';
    if (!a || !b || a.id === b.id) {
        $('compare-modes').innerHTML = '';
        $('compare-table').innerHTML = emptyRow(5, !a || !b ? '請在上方選擇兩位成員' : '請選擇兩位不同的成員');
        return;
    }
    const setA = new Set(a.ownedItems);
    const setB = new Set(b.ownedItems);
    const cat = $('compare-cat').value;
    const q = $('compare-search').value.trim().toLowerCase();
    const base = state.items
        .filter(i => !cat || i.category === cat)
        .filter(i => !q || i.name.toLowerCase().includes(q))
        .map(i => ({ item: i, ha: setA.has(i.id), hb: setB.has(i.id) }))
        .filter(r => r.ha || r.hb);

    const labels = { any: '任一人有', both: '兩人都有', onlyA: `只有 ${a.gameName} 有`, onlyB: `只有 ${b.gameName} 有` };
    const count = mode => base.filter(r => COMPARE_MODES[mode](r.ha, r.hb)).length;
    if (!COMPARE_MODES[state.compareMode]) state.compareMode = 'any';
    $('compare-modes').innerHTML = Object.keys(COMPARE_MODES).map(mode =>
        `<button class="chip${state.compareMode === mode ? ' active' : ''}" data-act="compare-mode" data-id="${mode}">${esc(labels[mode])}<small>${count(mode)}</small></button>`).join('');

    const list = base.filter(r => COMPARE_MODES[state.compareMode](r.ha, r.hb))
        .sort((x, y) => byCategoryThenName(x.item, y.item));
    if (list.length === 0) {
        $('compare-table').innerHTML = emptyRow(5, '沒有符合條件的項目');
        return;
    }
    $('compare-table').innerHTML = list.map(r => `<tr>
        <td><button class="link" data-act="item-detail" data-id="${esc(r.item.id)}">${esc(r.item.name)}</button></td>
        <td class="center">${r.ha ? OWN_YES : OWN_NO}</td>
        <td class="center">${r.hb ? OWN_YES : OWN_NO}</td>
        <td>${rarityHtml(r.item.rarity)}</td>
        <td><span class="cat-badge">${categoryIcon(r.item.category)} ${esc(r.item.category)}</span></td>
    </tr>`).join('');
}

ACTIONS['compare-mode'] = mode => {
    state.compareMode = mode;
    renderCompare();
};

// 換成員：記下選擇再重畫
INPUTS['compare-member'] = el => {
    state[el.id === 'compare-a' ? 'compareA' : 'compareB'] = el.value;
    renderCompare();
};
