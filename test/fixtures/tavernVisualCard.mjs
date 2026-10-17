const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#597fbc"/><circle cx="30" cy="25" r="12" fill="#ffe09b"/></svg>')}`;
const opening = (scene, time, location) => `${scene}第一段。\n\n旅人〔开心〕「一起出发吧。」\n\n<IllustrationImpl ref="landscape#1" />\n\n旅人〔日常〕「继续往前走。」\n\n${scene}最后一段。\n\n<initvar>\nenv:\n  time: "${time}"\n  location: ${location}\n</initvar>`;
const morning = opening("清晨", "07:20", "旅店");
const evening = opening("傍晚", "18:10", "庭院");
const chooser = '```html\n<button onclick="setChatMessages([{message_id:0, swipe_id:1}])">进入清晨</button>\n```';
const scriptContent = `
  const host = parent.document;
  parent.__visualProtectionProbe = () => {
    try { host.getElementById('root').remove(); return 'not rejected'; }
    catch (error) { return error.name; }
  };
  const style = host.createElement('style');
  style.textContent = '.visual-avatar{width:40px;height:40px;vertical-align:middle;margin-right:8px}.visual-illustration{display:block;width:180px;max-width:100%;height:auto}.visual-hud{position:fixed;right:12px;top:12px;z-index:2147483000;background:#172033;color:white;border-radius:8px;padding:12px}';
  // Many card decorators assume a dark host and replace its prose typography.
  style.textContent += '.visual-prose{font-family:monospace;font-size:30px;color:#e8eef6}.visual-dialogue,.visual-narrative{font-family:serif;font-size:26px;color:#eef5fb}';
  style.textContent += '.visual-panel{background:#172033;color:#eef5fb;font-family:serif}.visual-caption{color:#ffffff;font-family:serif;font-size:12px}';
  style.textContent += '.visual-speaker{color:#ffcf9a;font-family:serif;font-size:22px}.visual-speaker-alt{color:#9fd8ff}';
  host.head.appendChild(style);
  const hud = host.createElement('aside');
  hud.className = 'visual-hud';
  hud.setAttribute('aria-label', '角色浮动状态');
  host.body.appendChild(hud);
  const paint = () => {
    const message = getChatMessages(0)[0];
    const box = host.querySelector('#chat .mes[mesid="0"] .mes_text');
    if (!message || !box) return;
    const env = getVariables({type:'message', message_id:0}).stat_data?.env;
    if (env) hud.textContent = env.time + ' · ' + env.location;
    const lines = message.message.replace(/<initvar>[\\s\\S]*?<\\/initvar>/gi, '').trim().split(/\\n{2,}/);
    let index = 0;
    for (const paragraph of box.querySelectorAll(':scope > p')) {
      if (!lines[index]) break;
      if (paragraph.dataset.visualDone === 'true') { index++; continue; }
      const source = lines[index];
      if (source.startsWith('<IllustrationImpl')) {
        if (paragraph.textContent.trim()) continue;
        const art = host.createElement('img');
        art.className = 'visual-illustration';
        art.alt = '风景插画';
        art.src = ${JSON.stringify(image)};
        const panel = host.createElement('details');
        panel.className = 'visual-panel';
        panel.open = true;
        panel.innerHTML = '<summary>插画说明</summary><span class="visual-caption">独立面板文字</span>';
        paragraph.replaceChildren(art, panel);
      } else {
        if (!paragraph.textContent.includes(source)) continue;
        if (source.startsWith('旅人〔')) {
          const avatar = host.createElement('img');
          avatar.className = 'visual-avatar';
          avatar.alt = '角色对话头像';
          avatar.src = ${JSON.stringify(image)};
          const alternate = source.includes('〔日常〕');
          const speaker = host.createElement(alternate ? 'strong' : 'b');
          speaker.className = 'visual-speaker' + (alternate ? ' visual-speaker-alt' : '');
          if (alternate) {
            const label = host.createElement('span');
            label.textContent = '旅人';
            speaker.appendChild(label);
          } else speaker.textContent = '旅人';
          const dialogue = host.createElement('span');
          dialogue.className = 'visual-dialogue';
          dialogue.textContent = source.replace(/^旅人〔[^〕]*〕/, '');
          paragraph.replaceChildren(avatar, speaker, dialogue);
        } else {
          const narrative = host.createElement('span');
          narrative.className = 'visual-narrative';
          narrative.textContent = source;
          paragraph.replaceChildren(narrative);
        }
      }
      paragraph.classList.add('visual-prose');
      paragraph.dataset.visualDone = 'true';
      index++;
    }
  };
  const schedule = () => setTimeout(paint, 0);
  ['chat_changed', 'message_swiped', 'character_message_rendered', 'mag_variable_initialized', 'variable_changed'].forEach(event => eventOn(event, schedule));
  let observedChat;
  const observer = new parent.MutationObserver(schedule);
  setInterval(() => {
    const chat = host.getElementById('chat');
    if (chat && chat !== observedChat) {
      observer.disconnect();
      observer.observe(chat, {childList:true, subtree:true});
      observedChat = chat;
      schedule();
    }
  }, 100);
  parent.__visualRuntimeReady = true;
`;

export function createTavernVisualSeed(now = new Date().toISOString()) {
  const card = {
    id: "visual-card", name: "旅人", firstMessage: chooser, alternateGreetings: [morning, evening],
    tavernScripts: [{id:"visual-script", name:"Card visual fixture", enabled:true, autoRun:true, runOn:"startup", content:scriptContent}],
    regexScripts: [{id:"hide-init", scriptName:"Hide variable initialization", findRegex:"/<initvar>[\\s\\S]*?<\\/initvar>/gi", replaceString:"", placement:[2], markdownOnly:true, disabled:false}],
    createdAt: now, updatedAt: now,
  };
  const seed = {
    version: 1, chatMode: "roleplay", chatHtmlRenderEnabled: true, chatMultiBubbleEnabled: false,
    chatPersonalization: {messageFontFamily:"lxgw-wenkai-screen", messageFontSize:18, quoteStyleEnabled:true, quoteStyleColor:"#bb6600", italicStyleEnabled:true, italicStyleColor:"#665599"},
    activeCharacterCardId: card.id, characterCards: [card],
    chatSessions: [{id:"visual-chat", title:"视觉渲染测试", mode:"roleplay", roleplayCharacterCardId:card.id, roleplayGreetingIndex:0,
      messages:[{id:"greeting", role:"assistant", source:"roleplay-greeting", content:chooser, createdAt:now}], createdAt:now, updatedAt:now}],
  };
  return seed;
}
