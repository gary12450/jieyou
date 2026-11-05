// 公會競賽：依成員勾選的擁有項目，自動統計紅金紫品項（見 config.js 的 COMP_RARITIES）各有幾人擁有、是誰

function compRarityCounts() {
    const counts = {};
    state.items.forEach(i => { if (COMP_RARITIES.includes(i.rarity)) counts[i.rarity] = (counts[i.rarity] || 0) + 1; });
    return counts;
}

function renderCompFilters() {
    const counts = compRarityCounts();
    if (state.compRarity && !counts[state.compRarity]) state.compRarity = '';
    const total = COMP_RARITIES.reduce((n, r) => n + (counts[r] || 0), 0);
    const chip = (value, label, n) =>
        `<button class="chip${state.compRarity === value ? ' active' : ''}" data-act="comp-rarity" data-id="${esc(value)}">${label}<small>${n}</small></button>`;
    $('comp-rarities').innerHTML = chip('', '全部', total) +
        COMP_RARITIES.filter(r => counts[r]).map(r => chip(r, rarityHtml(r), counts[r])).join('');

    const sel = $('comp-guild');
    const keep = sel.value;
    sel.innerHTML = '<option value="">全部公會</option>' + state.guilds.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    sel.value = state.guilds.includes(keep) ? keep : '';
    sel.classList.toggle('hidden', state.guilds.length === 0);
}

// 每個紅金紫品項配上擁有的成員（可依公會篩選）；擁有人數多的排前面
function compRows() {
    const guild = $('comp-guild').value;
    const q = $('comp-search').value.trim().toLowerCase();
    const members = state.members.filter(m => !guild || m.guild === guild)
        .sort((a, b) => byText(a.gameName, b.gameName));
    return state.items
        .filter(i => COMP_RARITIES.includes(i.rarity) && (!state.compRarity || i.rarity === state.compRarity))
        .map(i => ({ item: i, owners: members.filter(m => m.ownedItems.includes(i.id)) }))
        .filter(r => !q || r.item.name.toLowerCase().includes(q) || r.owners.some(m => m.gameName.toLowerCase().includes(q)))
        .sort((a, b) => (b.owners.length - a.owners.length) || byCategoryThenName(a.item, b.item));
}

function compRowHtml(r) {
    const n = r.owners.length;
    const names = n
        ? '<div class="tags">' + r.owners.map(m => `<button class="tag link" data-act="member-detail" data-id="${esc(m.id)}">${esc(m.gameName)}</button>`).join('') + '</div>'
        : '<span class="muted">—</span>';
    return `<tr>
        <td><button class="link" data-act="item-detail" data-id="${esc(r.item.id)}">${esc(r.item.name)}</button></td>
        <td class="center"><span class="count-pill${n ? '' : ' is-empty'}" data-act="item-detail" data-id="${esc(r.item.id)}">${n} 人</span></td>
        <td class="comp-names">${names}</td>
    </tr>`;
}

function renderCompetitions() {
    const rows = compRows();
    if (rows.length === 0) {
        const hasAny = state.items.some(i => COMP_RARITIES.includes(i.rarity));
        $('competitions-table').innerHTML = emptyRow(3, hasAny
            ? '找不到符合條件的品項'
            : '圖鑑還沒有仙品、華品、珍品的項目（在圖鑑設定稀有度後會自動出現在這裡）');
        return;
    }
    // 依稀有度分組（紅→金→紫），每組前面一列標題
    $('competitions-table').innerHTML = COMP_RARITIES.map(rarity => {
        const group = rows.filter(r => r.item.rarity === rarity);
        if (!group.length) return '';
        return `<tr class="group-row"><td colspan="3">${rarityHtml(rarity)}<small>${group.length} 項</small></td></tr>` +
            group.map(compRowHtml).join('');
    }).join('');
}

ACTIONS['comp-rarity'] = rarity => {
    state.compRarity = rarity;
    renderCompFilters();
    renderCompetitions();
};
