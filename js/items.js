// 圖鑑：食靈、時裝、作物、料理…等所有可收集項目；會員可新增，並勾選自己擁有哪些

function itemOwners(itemId) { return state.members.filter(m => m.ownedItems.includes(itemId)); }

// ---------- 稀有度（五級，見 config.js 的 RARITIES） ----------

function rarityInfo(name) { return RARITIES.find(r => r.name === name) || null; }
// 越稀有數字越大；未填或不在清單內（舊資料）＝ -1
function rarityRank(name) { return RARITIES.findIndex(r => r.name === name); }

function rarityHtml(name) {
    if (!name) return '';
    const r = rarityInfo(name);
    if (!r) return esc(name); // 改成五級前自由填寫的舊值，照原文字顯示
    return `<span class="rarity" style="--r:${esc(r.color)}"><span class="rarity-dot">${esc(r.short)}</span>${esc(r.name)}</span>`;
}

function rarityPickerHtml(current) {
    const opt = (value, inner, plain) => `<label><input type="radio" name="rarity" value="${esc(value)}" ${value === (current || '') ? 'checked' : ''}>
        <span class="rarity-opt${plain ? ' plain' : ''}">${inner}</span></label>`;
    const legacy = current && !rarityInfo(current) ? opt(current, esc(current), true) : '';
    return `<div class="rarity-picker">${opt('', '未填', true)}${RARITIES.map(r => opt(r.name, rarityHtml(r.name))).join('')}${legacy}</div>`;
}

function categoryRank(cat) {
    const i = categoriesInUse().indexOf(cat);
    return i < 0 ? 999 : i;
}
function byCategoryThenName(a, b) { return (categoryRank(a.category) - categoryRank(b.category)) || byText(a.name, b.name); }

// 勾選清單用的選項（成員擁有、競賽參賽共用）
function itemChecklistOptions(items) {
    return (items || state.items).slice().sort(byCategoryThenName)
        .map(i => ({ value: i.id, label: i.name, group: i.category, sub: i.rarity }));
}

function renderItemCats() {
    const counts = {};
    state.items.forEach(i => { counts[i.category] = (counts[i.category] || 0) + 1; });
    const cats = categoriesInUse().filter(c => counts[c]);
    if (state.itemCategory && !counts[state.itemCategory]) state.itemCategory = '';
    const chip = (value, label, n) =>
        `<button class="chip${state.itemCategory === value ? ' active' : ''}" data-act="item-cat" data-id="${esc(value)}">${label}<small>${n}</small></button>`;
    $('item-cats').innerHTML = chip('', '全部', state.items.length) +
        cats.map(c => chip(c, categoryIcon(c) + ' ' + esc(c), counts[c])).join('');
}

const ITEM_SORTS = {
    category: byCategoryThenName,
    rarity: (a, b) => (rarityRank(b.rarity) - rarityRank(a.rarity)) || byCategoryThenName(a, b),
    release: (a, b) => byText(b.releaseDate, a.releaseDate) || byCategoryThenName(a, b),
    owners: (a, b) => (itemOwners(b.id).length - itemOwners(a.id).length) || byCategoryThenName(a, b),
    updated: (a, b) => byText(b.updatedAt, a.updatedAt)
};

function filteredItems() {
    const q = $('items-search').value.trim().toLowerCase();
    const sort = ITEM_SORTS[$('items-sort').value] || byCategoryThenName;
    return state.items
        .filter(i => !state.itemCategory || i.category === state.itemCategory)
        .filter(i => !q || [i.name, i.source, i.note, i.rarity].some(v => v.toLowerCase().includes(q)))
        .sort(sort);
}

function renderItems() {
    const list = filteredItems();
    if (list.length === 0) {
        $('items-table').innerHTML = emptyRow(9, state.items.length ? '找不到符合條件的項目' : '圖鑑還是空的，按「＋ 新增圖鑑項目」開始建立');
        return;
    }
    $('items-table').innerHTML = list.map(i => {
        const n = itemOwners(i.id).length;
        const ownersBtn = isManager()
            ? `<button class="icon-btn" data-act="item-owners" data-id="${esc(i.id)}" title="設定誰擁有" aria-label="設定誰擁有">👥</button>`
            : '';
        return `<tr>
            <td><button class="link" data-act="item-detail" data-id="${esc(i.id)}">${esc(i.name)}</button></td>
            <td><span class="cat-badge">${categoryIcon(i.category)} ${esc(i.category)}</span></td>
            <td>${rarityHtml(i.rarity)}</td>
            <td>${esc(i.unlockLevel)}</td>
            <td>${esc(i.source)}</td>
            <td>${esc(i.releaseDate)}</td>
            <td class="center"><span class="count-pill${n ? '' : ' is-empty'}" data-act="item-detail" data-id="${esc(i.id)}">${n} 人</span></td>
            <td title="${esc(i.note)}">${esc(i.note)}</td>
            <td class="actions">${actionButtons('item', i, ownersBtn)}</td>
        </tr>`;
    }).join('');
}

ACTIONS['item-cat'] = cat => {
    state.itemCategory = cat;
    renderItemCats();
    renderItems();
};

ACTIONS['item-detail'] = id => {
    const i = state.itemMap.get(id);
    if (!i) return;
    const owners = itemOwners(i.id);
    const ownersHtml = owners.length
        ? '<div class="tags">' + owners.slice().sort((a, b) => byText(a.guild, b.guild) || byText(a.gameName, b.gameName))
            .map(m => `<button class="tag link" data-act="member-detail" data-id="${esc(m.id)}">${esc(m.gameName)}${m.guild ? `<small class="muted">・${esc(m.guild)}</small>` : ''}</button>`).join('') + '</div>'
        : '<div class="muted">還沒有成員登記擁有</div>';
    const btns = [
        isManager() ? `<button class="btn btn-ghost" data-act="item-owners" data-id="${esc(i.id)}">👥 設定誰擁有</button>` : '',
        canEdit(i.ownerId) ? `<button class="btn btn-ghost" data-act="item-edit" data-id="${esc(i.id)}">✏️ 編輯</button>` : '',
        canEdit(i.ownerId) ? `<button class="btn btn-danger" data-act="item-delete" data-id="${esc(i.id)}">🗑️ 刪除</button>` : ''
    ].join('');
    openModal(`
        <div class="modal-header"><div class="modal-subtitle">${categoryIcon(i.category)} ${esc(i.category)}</div><div class="modal-title">${esc(i.name)}</div></div>
        ${detailRowHtml('稀有度', rarityHtml(i.rarity) || '—')}
        ${detailRow('解鎖等級', i.unlockLevel)}
        ${detailRow('來源', i.source)}
        ${detailRow('上市日期', i.releaseDate)}
        ${detailRow('備註', i.note)}
        ${detailRow('建立者', i.ownerId)}
        ${detailRow('最後更新', i.updatedAt ? formatTime(i.updatedAt) + '（' + i.updatedBy + '）' : '')}
        <div class="section-title">👥 誰擁有（${owners.length}）</div>
        ${ownersHtml}
        ${btns ? `<div class="modal-actions">${btns}</div>` : ''}`);
};

// 來源下拉選單：選項見 config.js 的 SOURCES；不在清單內的舊值另列一項並保持選取，存檔才不會被清掉
function sourceSelectHtml(current) {
    const opt = (value, label) => `<option value="${esc(value)}" ${value === (current || '') ? 'selected' : ''}>${esc(label)}</option>`;
    const legacy = current && !SOURCES.includes(current) ? opt(current, current + '（舊選項）') : '';
    return `<select name="source">${opt('', '未填')}${SOURCES.map(s => opt(s, s)).join('')}${legacy}</select>`;
}

function datalistHtml(id, values) {
    const uniq = Array.from(new Set(values.filter(Boolean))).sort(byText);
    return `<datalist id="${id}">${uniq.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

function openItemForm(i) {
    const defaultCat = i ? i.category : (state.itemCategory || CATEGORIES[0].name);
    const cats = categoriesInUse();
    openModal(`
        <div class="modal-header"><div class="modal-subtitle">圖鑑</div><div class="modal-title">${i ? '編輯圖鑑項目' : '新增圖鑑項目'}</div></div>
        <form data-form="item" data-id="${i ? esc(i.id) : ''}">
            <div class="form-grid">
                <div class="field"><label>類別 <span class="req">*</span></label>
                    <select name="category" required>
                        ${cats.map(c => `<option value="${esc(c)}" ${c === defaultCat ? 'selected' : ''}>${categoryIcon(c)} ${esc(c)}</option>`).join('')}
                    </select></div>
                <div class="field"><label>名稱 <span class="req">*</span></label>
                    <input type="text" name="name" required maxlength="40" value="${esc(i ? i.name : '')}"></div>
                <div class="field full"><label>稀有度</label>${rarityPickerHtml(i ? i.rarity : '')}</div>
                <div class="field"><label>解鎖等級</label>
                    <input type="text" name="unlockLevel" maxlength="10" inputmode="numeric" value="${esc(i ? i.unlockLevel : '')}"></div>
                <div class="field"><label>來源</label>
                    ${sourceSelectHtml(i ? i.source : '')}</div>
                <div class="field"><label>上市日期（台版）</label>
                    <input type="date" name="releaseDate" value="${esc(i ? i.releaseDate : '')}"></div>
                <div class="field full"><label>備註</label>
                    <textarea name="note" maxlength="300" placeholder="取得方式、用途、配方…">${esc(i ? i.note : '')}</textarea></div>
            </div>
            <div class="form-buttons">
                <button type="button" class="btn btn-ghost" data-act="modal-close">取消</button>
                <button type="submit" class="btn btn-save">💾 儲存</button>
            </div>
        </form>`, true); // 加寬：稀有度六個選項才排得下一行
}

ACTIONS['item-add'] = () => { if (requireLogin('新增圖鑑項目')) openItemForm(null); };
ACTIONS['item-edit'] = id => {
    const i = state.itemMap.get(id);
    if (i && requireLogin('編輯圖鑑')) openItemForm(i);
};

FORMS.item = async form => {
    if (!requireLogin('儲存圖鑑')) return;
    const v = formValues(form);
    const id = form.dataset.id;
    const item = {
        category: v.category, name: v.name.trim(), rarity: (v.rarity || '').trim(), unlockLevel: v.unlockLevel.trim(),
        source: v.source.trim(), releaseDate: v.releaseDate, note: v.note.trim()
    };
    const r = await apiCall({ action: id ? 'updateItem' : 'addItem', type: 'items', id, item }, '儲存失敗');
    if (!r) return;
    upsertRecord('items', r.record);
    closeModal();
    renderAll();
};

ACTIONS['item-delete'] = async id => {
    const i = state.itemMap.get(id);
    if (!i) return;
    const n = itemOwners(i.id).length;
    const extra = n ? `\n目前有 ${n} 位成員勾選擁有，刪除後他們的清單不再顯示這個項目。` : '';
    if (!(await confirmBox(`確定要刪除「${i.category}／${i.name}」嗎？${extra}`, '刪除'))) return;
    if (!(await apiCall({ action: 'deleteItem', type: 'items', id }, '刪除失敗'))) return;
    removeRecord('items', id);
    closeModal();
    renderAll();
};

// ---------- 管理員：一次設定誰擁有 ----------

ACTIONS['item-owners'] = id => {
    const i = state.itemMap.get(id);
    if (!i || !isManager()) return;
    const options = state.members.slice().sort((a, b) => byText(a.gameName, b.gameName))
        .map(m => ({ value: m.id, label: m.gameName, group: m.guild || '未填公會', sub: '' }));
    const groups = state.guilds.concat(['未填公會']).concat(state.members.map(m => m.guild).filter(g => g && !state.guilds.includes(g)));
    openModal(`
        <div class="modal-header"><div class="modal-subtitle">管理員・一次設定誰擁有</div><div class="modal-title">${categoryIcon(i.category)} ${esc(i.name)}</div></div>
        <form data-form="item-owners" data-id="${esc(i.id)}">
            ${checklistHtml('item-owner-list', options, itemOwners(i.id).map(m => m.id), groups, '還沒有任何成員')}
            <div class="form-buttons">
                <button type="button" class="btn btn-ghost" data-act="modal-close">取消</button>
                <button type="submit" class="btn btn-save">💾 儲存</button>
            </div>
        </form>`, true);
};

// 只送出「這次有改」的成員（和開啟時的勾選狀態比對），沒動到的成員由後端維持現狀
FORMS['item-owners'] = async form => {
    const boxes = Array.from(form.querySelectorAll('.checklist-box input[type=checkbox]'));
    const add = boxes.filter(cb => cb.checked && !cb.defaultChecked).map(cb => cb.value);
    const remove = boxes.filter(cb => !cb.checked && cb.defaultChecked).map(cb => cb.value);
    if (!add.length && !remove.length) {
        closeModal();
        return;
    }
    const r = await apiCall({ action: 'setItemOwners', itemId: form.dataset.id, add, remove }, '儲存失敗');
    if (!r) return;
    (r.members || []).forEach(rec => upsertRecord('members', rec));
    closeModal();
    renderAll();
    notify(r.members && r.members.length ? `已更新 ${r.members.length} 位成員的擁有清單。` : '沒有需要變更的成員（可能其他人剛改過，請重新整理確認）。');
};
