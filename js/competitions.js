// 公會競賽：每期登記成員與參賽項目（預設從該成員擁有的圖鑑項目中挑）

const ALL_PERIODS = '__all';

function periodsInUse() {
    return Array.from(new Set(state.competitions.map(c => c.period).filter(Boolean))).sort((a, b) => byText(b, a));
}
function compMember(c) { return state.memberMap.get(c.memberId) || null; }
function compMemberName(c) { const m = compMember(c); return m ? m.gameName : '（已刪除成員）'; }
function compItemNames(c) { return c.selectedItems.map(id => state.itemMap.get(id)).filter(Boolean).map(i => i.name); }
function scoreValue(s) { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? -Infinity : n; }

function renderCompFilters() {
    const periods = periodsInUse();
    // 第一次載入預設顯示最新一期；之後保留使用者的選擇
    if (state.compPeriod === null || (state.compPeriod !== ALL_PERIODS && !periods.includes(state.compPeriod))) {
        state.compPeriod = periods[0] || ALL_PERIODS;
    }
    $('comp-period').innerHTML = `<option value="${ALL_PERIODS}">全部期別</option>` +
        periods.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    $('comp-period').value = state.compPeriod;

    const sel = $('comp-guild');
    const keep = sel.value;
    sel.innerHTML = '<option value="">全部公會</option>' + state.guilds.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    sel.value = state.guilds.includes(keep) ? keep : '';
    sel.classList.toggle('hidden', state.guilds.length === 0);
}

function filteredComps() {
    const period = state.compPeriod;
    const guild = $('comp-guild').value;
    const q = $('comp-search').value.trim().toLowerCase();
    return state.competitions
        .filter(c => period === ALL_PERIODS || c.period === period)
        .filter(c => !guild || (compMember(c) && compMember(c).guild === guild))
        .filter(c => !q || [compMemberName(c)].concat(compItemNames(c)).some(v => v.toLowerCase().includes(q)))
        .sort((a, b) => byText(b.period, a.period) || (scoreValue(b.score) - scoreValue(a.score)) || byText(compMemberName(a), compMemberName(b)));
}

function renderCompetitions() {
    const list = filteredComps();
    if (list.length === 0) {
        $('competitions-table').innerHTML = emptyRow(7, state.competitions.length ? '這個條件下沒有競賽紀錄' : '還沒有競賽紀錄，按「＋ 登記競賽」開始');
        return;
    }
    $('competitions-table').innerHTML = list.map(c => {
        const m = compMember(c);
        return `<tr>
            <td>${esc(c.period)}</td>
            <td><button class="link" data-act="comp-detail" data-id="${esc(c.id)}">${esc(compMemberName(c))}</button></td>
            <td>${m && m.guild ? esc(m.guild) : '<span class="muted">—</span>'}</td>
            <td>${tagsHtml(compItemNames(c), 5)}</td>
            <td class="num">${esc(c.score)}</td>
            <td title="${esc(c.note)}">${esc(c.note)}</td>
            <td class="actions">${actionButtons('comp', c)}</td>
        </tr>`;
    }).join('');
}

ACTIONS['comp-detail'] = id => {
    const c = state.competitions.find(x => x.id === id);
    if (!c) return;
    const m = compMember(c);
    const items = c.selectedItems.map(x => state.itemMap.get(x)).filter(Boolean);
    const btns = canEdit(c.ownerId)
        ? `<div class="modal-actions">
               <button class="btn btn-ghost" data-act="comp-edit" data-id="${esc(c.id)}">✏️ 編輯</button>
               <button class="btn btn-danger" data-act="comp-delete" data-id="${esc(c.id)}">🗑️ 刪除</button>
           </div>`
        : '';
    openModal(`
        <div class="modal-header"><div class="modal-subtitle">🏆 ${esc(c.period)}</div><div class="modal-title">${esc(compMemberName(c))}</div></div>
        ${detailRow('公會', m ? m.guild : '')}
        ${detailRow('分數', c.score)}
        ${detailRow('備註', c.note)}
        ${detailRow('登記者', c.ownerId)}
        ${detailRow('最後更新', c.updatedAt ? formatTime(c.updatedAt) + '（' + c.updatedBy + '）' : '')}
        <div class="section-title">參賽項目（${items.length}）</div>
        ${ownedByCategoryHtml(items)}
        ${btns}`);
};

// 參賽項目清單：預設只列該成員擁有的；勾「顯示全部圖鑑」可選未登記擁有的
function compItemsHtml(memberId, selected, showAll) {
    const m = state.memberMap.get(memberId);
    if (!m) return '<div class="hint">請先選擇成員</div>';
    const pool = showAll ? state.items : state.items.filter(i => m.ownedItems.includes(i.id) || selected.includes(i.id));
    const empty = showAll ? '圖鑑還沒有任何項目' : '這位成員還沒登記擁有任何項目（可勾選上方「顯示全部圖鑑」）';
    return checklistHtml('comp-items', itemChecklistOptions(pool), selected, categoriesInUse(), empty);
}

function memberSelectHtml(selectedId) {
    const sorted = state.members.slice().sort((a, b) => byText(a.gameName, b.gameName));
    const opt = m => `<option value="${esc(m.id)}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.gameName)}（${esc(m.gameId)}）</option>`;
    const groups = state.guilds.map(g => ({ g, list: sorted.filter(m => m.guild === g) }))
        .concat([{ g: '未填公會／其他', list: sorted.filter(m => !state.guilds.includes(m.guild)) }])
        .filter(x => x.list.length);
    return `<select name="memberId" required data-change="comp-member">
        <option value="">選擇成員</option>
        ${groups.map(x => `<optgroup label="${esc(x.g)}">${x.list.map(opt).join('')}</optgroup>`).join('')}
    </select>`;
}

function openCompForm(c) {
    if (!state.members.length) {
        notify('還沒有任何成員，請先到「成員清單」新增成員。');
        return;
    }
    // 新增時：若目前帳號只建立過一位成員，就直接帶入
    const mine = state.members.filter(m => session && m.ownerId === session.username);
    const memberId = c ? c.memberId : (mine.length === 1 ? mine[0].id : '');
    const period = c ? c.period : currentPeriod();
    const periods = Array.from(new Set([currentPeriod()].concat(periodsInUse())));
    openModal(`
        <div class="modal-header"><div class="modal-subtitle">公會競賽</div><div class="modal-title">${c ? '編輯競賽紀錄' : '登記競賽'}</div></div>
        <form data-form="comp" data-id="${c ? esc(c.id) : ''}">
            <div class="form-grid">
                <div class="field"><label>期別 <span class="req">*</span></label>
                    <input type="text" name="period" required maxlength="30" list="dl-period" value="${esc(period)}">
                    ${datalistHtml('dl-period', periods)}
                    <span class="hint">預設為本週，可改成活動名稱等任意文字</span></div>
                <div class="field"><label>成員 <span class="req">*</span></label>${memberSelectHtml(memberId)}</div>
                <div class="field"><label>分數／貢獻</label>
                    <input type="text" name="score" maxlength="20" inputmode="decimal" value="${esc(c ? c.score : '')}"></div>
                <div class="field"><label>備註</label>
                    <input type="text" name="note" maxlength="200" value="${esc(c ? c.note : '')}"></div>
                <div class="field full">
                    <label>參賽項目　<span class="checklist-only"><input type="checkbox" id="comp-show-all" data-change="comp-member"> 顯示全部圖鑑</span></label>
                    <div id="comp-items-wrap">${compItemsHtml(memberId, c ? c.selectedItems : [], false)}</div>
                </div>
            </div>
            <div class="form-buttons">
                <button type="button" class="btn btn-ghost" data-act="modal-close">取消</button>
                <button type="submit" class="btn btn-save">💾 儲存</button>
            </div>
        </form>`, true);
}

// 換成員或切換「顯示全部圖鑑」：重畫參賽清單，保留已勾選的
INPUTS['comp-member'] = el => {
    const form = el.closest('form');
    const selected = document.getElementById('comp-items') ? checklistValues('comp-items') : [];
    const wrap = $('comp-items-wrap');
    wrap.innerHTML = compItemsHtml(form.elements.memberId.value, selected, $('comp-show-all').checked);
    wrap.querySelectorAll('.checklist').forEach(refreshChecklist);
};

ACTIONS['comp-add'] = () => { if (requireLogin('登記競賽')) openCompForm(null); };
ACTIONS['comp-edit'] = id => {
    const c = state.competitions.find(x => x.id === id);
    if (c && requireLogin('編輯競賽紀錄')) openCompForm(c);
};

FORMS.comp = async form => {
    if (!requireLogin('儲存競賽紀錄')) return;
    const v = formValues(form);
    const id = form.dataset.id;
    const old = id ? state.competitions.find(x => x.id === id) : null;
    // 同成員表單：已刪除的圖鑑項目不在清單裡，保留原本的 id，項目救回時才不會遺失
    const hidden = old ? old.selectedItems.filter(x => !state.itemMap.has(x)) : [];
    const item = {
        period: v.period.trim(), memberId: v.memberId, score: v.score.trim(), note: v.note.trim(),
        selectedItems: (document.getElementById('comp-items') ? checklistValues('comp-items') : []).concat(hidden)
    };
    const r = await apiCall({ action: id ? 'updateItem' : 'addItem', type: 'competitions', id, item }, '儲存失敗');
    if (!r) return;
    upsertRecord('competitions', r.record);
    state.compPeriod = r.record.period;
    closeModal();
    renderAll();
};

ACTIONS['comp-delete'] = async id => {
    const c = state.competitions.find(x => x.id === id);
    if (!c) return;
    if (!(await confirmBox(`確定要刪除「${compMemberName(c)}」在 ${c.period} 的競賽紀錄嗎？`, '刪除'))) return;
    if (!(await apiCall({ action: 'deleteItem', type: 'competitions', id }, '刪除失敗'))) return;
    removeRecord('competitions', id);
    closeModal();
    renderAll();
};
