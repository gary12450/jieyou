// 成員清單（遊戲名稱、遊戲ID、公會、島嶼等級、擁有的圖鑑項目）＋ 公會管理

const NO_GUILD = '__none';

function ownedItemsOf(m) { return m.ownedItems.map(id => state.itemMap.get(id)).filter(Boolean); }
function membersOfGuild(g) { return state.members.filter(m => m.guild === g); }

function renderMemberFilters() {
    const sel = $('members-guild');
    const keep = sel.value;
    const noGuild = state.members.some(m => !m.guild);
    // 公會被刪除後，成員資料仍留著舊公會名，也要能篩選得到
    const stray = Array.from(new Set(state.members.map(m => m.guild).filter(g => g && !state.guilds.includes(g)))).sort(byText);
    sel.innerHTML = '<option value="">全部公會</option>' +
        state.guilds.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('') +
        stray.map(g => `<option value="${esc(g)}">${esc(g)}（已刪除）</option>`).join('') +
        (noGuild ? `<option value="${NO_GUILD}">未填公會</option>` : '');
    sel.value = Array.from(sel.options).some(o => o.value === keep) ? keep : '';
    sel.classList.toggle('hidden', state.guilds.length === 0 && !noGuild && !stray.length);
}

function filteredMembers() {
    const q = $('members-search').value.trim().toLowerCase();
    const guild = $('members-guild').value;
    return state.members
        .filter(m => !guild || (guild === NO_GUILD ? !m.guild : m.guild === guild))
        .filter(m => !q || m.gameName.toLowerCase().includes(q) || m.gameId.toLowerCase().includes(q))
        .sort((a, b) => byText(a.guild, b.guild) || byText(a.gameName, b.gameName));
}

function renderMembers() {
    const list = filteredMembers();
    if (list.length === 0) {
        $('members-table').innerHTML = emptyRow(8, state.members.length ? '找不到符合條件的成員' : '還沒有成員資料，按「＋ 新增成員」登記你的角色');
        return;
    }
    $('members-table').innerHTML = list.map(m => {
        const n = ownedItemsOf(m).length;
        return `<tr>
            <td><button class="link" data-act="member-detail" data-id="${esc(m.id)}">${esc(m.gameName)}</button></td>
            <td>${esc(m.gameId)}</td>
            <td>${m.guild ? esc(m.guild) : '<span class="muted">—</span>'}</td>
            <td>${esc(m.islandLevel)}</td>
            <td class="center"><span class="count-pill${n ? '' : ' is-empty'}" data-act="member-detail" data-id="${esc(m.id)}">${n} 項</span></td>
            <td title="${esc(m.note)}">${esc(m.note)}</td>
            <td class="muted">${esc(m.ownerId)}</td>
            <td class="actions">${actionButtons('member', m)}</td>
        </tr>`;
    }).join('');
}

// 依類別分組顯示擁有的項目
function ownedByCategoryHtml(items) {
    if (!items.length) return '<div class="muted">尚未勾選任何項目</div>';
    return categoriesInUse().map(cat => {
        const names = items.filter(i => i.category === cat).map(i => i.name).sort(byText);
        if (!names.length) return '';
        return `<div class="section-title">${categoryIcon(cat)} ${esc(cat)}（${names.length}）</div>${tagsHtml(names)}`;
    }).join('');
}

ACTIONS['member-detail'] = id => {
    const m = state.memberMap.get(id);
    if (!m) return;
    const owned = ownedItemsOf(m);
    const comps = state.competitions.filter(c => c.memberId === m.id).length;
    const editBtns = canEdit(m.ownerId)
        ? `<div class="modal-actions">
               <button class="btn btn-ghost" data-act="member-edit" data-id="${esc(m.id)}">✏️ 編輯</button>
               <button class="btn btn-danger" data-act="member-delete" data-id="${esc(m.id)}">🗑️ 刪除</button>
           </div>`
        : '';
    openModal(`
        <div class="modal-header"><div class="modal-subtitle">${esc(m.guild || '未填公會')}</div><div class="modal-title">${esc(m.gameName)}</div></div>
        ${detailRow('遊戲ID', m.gameId)}
        ${detailRow('島嶼等級', m.islandLevel)}
        ${detailRow('競賽紀錄', comps + ' 筆')}
        ${detailRow('備註', m.note)}
        ${detailRow('建立者', m.ownerId)}
        ${detailRow('最後更新', m.updatedAt ? formatTime(m.updatedAt) + '（' + m.updatedBy + '）' : '')}
        <div class="section-title">📦 擁有的圖鑑項目（${owned.length}）</div>
        ${ownedByCategoryHtml(owned)}
        ${editBtns}`, true);
};

function guildFieldHtml(current) {
    if (!state.guilds.length) {
        return `<div class="field"><label>公會</label><input type="hidden" name="guild" value="">
            <span class="hint">尚未建立公會（由管理員在成員清單上方新增）</span></div>`;
    }
    return `<div class="field"><label>公會 <span class="req">*</span></label>
        <select name="guild" required>
            <option value="">選擇公會</option>
            ${state.guilds.map(g => `<option value="${esc(g)}" ${g === current ? 'selected' : ''}>${esc(g)}</option>`).join('')}
        </select></div>`;
}

function openMemberForm(m) {
    openModal(`
        <div class="modal-header"><div class="modal-subtitle">成員清單</div><div class="modal-title">${m ? '編輯成員' : '新增成員'}</div></div>
        <form data-form="member" data-id="${m ? esc(m.id) : ''}">
            <div class="form-grid">
                <div class="field"><label>遊戲名稱 <span class="req">*</span></label>
                    <input type="text" name="gameName" required maxlength="30" value="${esc(m ? m.gameName : '')}"></div>
                <div class="field"><label>遊戲ID <span class="req">*</span></label>
                    <input type="text" name="gameId" required maxlength="30" value="${esc(m ? m.gameId : '')}"></div>
                ${guildFieldHtml(m ? m.guild : '')}
                <div class="field"><label>島嶼等級</label>
                    <input type="text" name="islandLevel" maxlength="10" inputmode="numeric" value="${esc(m ? m.islandLevel : '')}"></div>
                <div class="field full"><label>備註</label>
                    <input type="text" name="note" maxlength="200" value="${esc(m ? m.note : '')}" placeholder="例如：每天晚上上線、可借海鮮"></div>
                <div class="field full"><label>擁有的圖鑑項目（勾選後公會夥伴查得到你有什麼，串門借食材更方便）</label>
                    ${checklistHtml('member-owned', itemChecklistOptions(), m ? m.ownedItems : [], categoriesInUse(), '圖鑑還沒有任何項目，請先到「📖 圖鑑」分頁新增')}</div>
            </div>
            <div class="form-buttons">
                <button type="button" class="btn btn-ghost" data-act="modal-close">取消</button>
                <button type="submit" class="btn btn-save">💾 儲存</button>
            </div>
        </form>`, true);
}

ACTIONS['member-add'] = () => { if (requireLogin('新增成員')) openMemberForm(null); };
ACTIONS['member-edit'] = id => {
    const m = state.memberMap.get(id);
    if (m && requireLogin('編輯成員')) openMemberForm(m);
};

FORMS.member = async form => {
    if (!requireLogin('儲存成員')) return;
    const v = formValues(form);
    const id = form.dataset.id;
    const old = id ? state.memberMap.get(id) : null;
    // 已被刪除的圖鑑項目不在勾選清單裡，保留原本的勾選，項目救回時才不會遺失
    const hidden = old ? old.ownedItems.filter(x => !state.itemMap.has(x)) : [];
    const item = {
        gameName: v.gameName.trim(), gameId: v.gameId.trim(), guild: v.guild || '',
        islandLevel: v.islandLevel.trim(), note: v.note.trim(),
        ownedItems: checklistValues('member-owned').concat(hidden)
    };
    const r = await apiCall({ action: id ? 'updateItem' : 'addItem', type: 'members', id, item }, '儲存失敗');
    if (!r) return;
    upsertRecord('members', r.record);
    closeModal();
    renderAll();
};

ACTIONS['member-delete'] = async id => {
    const m = state.memberMap.get(id);
    if (!m) return;
    const comps = state.competitions.filter(c => c.memberId === m.id).length;
    const extra = comps ? `\n他的 ${comps} 筆競賽紀錄會保留，成員欄會顯示「已刪除成員」。` : '';
    if (!(await confirmBox(`確定要刪除成員「${m.gameName}」嗎？${extra}`, '刪除'))) return;
    if (!(await apiCall({ action: 'deleteItem', type: 'members', id }, '刪除失敗'))) return;
    removeRecord('members', id);
    closeModal();
    renderAll();
};

// ---------- 公會管理（僅管理員） ----------

function renderGuildPanel() {
    $('guild-list').innerHTML = state.guilds.length
        ? state.guilds.map(g => `<span class="guild-tag">${esc(g)} <small class="muted">${membersOfGuild(g).length} 人</small>
              <button class="icon-btn" data-act="guild-delete" data-id="${esc(g)}" aria-label="刪除公會 ${esc(g)}">×</button></span>`).join('')
        : '<span class="muted">尚未建立公會。建立後，成員登記時就能選擇公會。</span>';
}

FORMS['guild-add'] = async form => {
    const name = form.querySelector('input').value.trim();
    if (!name) return;
    if (!(await apiCall({ action: 'addGuild', name }, '新增公會失敗'))) return;
    state.guilds = state.guilds.concat([name]);
    form.reset();
    renderAll();
};

ACTIONS['guild-delete'] = async name => {
    const n = membersOfGuild(name).length;
    const extra = n ? `\n目前有 ${n} 位成員屬於這個公會，他們的資料會保留原公會名稱，但之後編輯時需改選其他公會。` : '';
    if (!(await confirmBox(`確定要刪除公會「${name}」嗎？${extra}`, '刪除'))) return;
    if (!(await apiCall({ action: 'deleteGuild', name }, '刪除公會失敗'))) return;
    state.guilds = state.guilds.filter(g => g !== name);
    renderAll();
};
