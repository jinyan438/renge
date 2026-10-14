import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCharacterCard, normalizeStoredCharacterCard, exportCharacterCardJson,
} from "../src/characterCardUtils.ts";

const originals = [
  {id:"native-board-a",scriptName:"Board A",findRegex:"<board_a>",replaceString:"Board A UI",disabled:false,placement:[2]},
  {id:"native-board-b",scriptName:"Board B",findRegex:"<board_b>",replaceString:"Board B UI",disabled:true,placement:[2]},
];
const createCard = (regexes=originals) => normalizeCharacterCard({name:"Board fixture",extensions:{regex_scripts:regexes}});

test("character import, normalization and export retain script-addressable regex IDs", () => {
  const card = createCard();
  assert.deepEqual(card.regexScripts.map(rule=>rule.id), originals.map(rule=>rule.id));
  assert.equal(card.regexScripts.length, 2, "mirrored root/data sources are deduplicated");
  const exported = JSON.parse(exportCharacterCardJson(card));
  assert.deepEqual(exported.data.extensions.regex_scripts.map(rule=>rule.id), originals.map(rule=>rule.id));
  assert.deepEqual(normalizeCharacterCard(exported).regexScripts.map(rule=>rule.id), originals.map(rule=>rule.id));
});

test("distinct IDs with identical regex bodies remain separately addressable", () => {
  const card = createCard([originals[0],{...originals[0],id:"native-board-copy"}]);
  assert.deepEqual(card.regexScripts.map(rule=>rule.id),["native-board-a","native-board-copy"]);
});

test("stored imports recover original IDs without replacing edits, state, order or card identity", () => {
  const card = createCard();
  card.regexScripts = card.regexScripts.reverse().map((rule,index)=>({...rule,id:`character-regex-old-${index}`}));
  card.regexScripts[0].replaceString = "Edited UI";
  card.regexScripts[0].disabled = false;
  card.regexScripts[1].findRegex = "<edited_board_a>";
  const before = structuredClone(card);
  for (const normalize of [normalizeStoredCharacterCard,normalizeCharacterCard]) {
    const recovered = normalize(card);
    assert.deepEqual(recovered.regexScripts.map(rule=>rule.id),["native-board-b","native-board-a"]);
    assert.equal(recovered.regexScripts[0].replaceString,"Edited UI");
    assert.equal(recovered.regexScripts[0].disabled,false);
    assert.equal(recovered.regexScripts[1].findRegex,"<edited_board_a>");
    assert.equal(recovered.id,card.id);
    assert.equal(recovered.updatedAt,card.updatedAt);
    assert.equal(normalizeStoredCharacterCard(recovered),recovered,"migration is idempotent");
  }
  assert.deepEqual(card,before,"migration leaves input data intact");
});

test("missing or ambiguous originals and deliberately assigned IDs are preserved", () => {
  const card = createCard([originals[0],{...originals[0],id:"other",replaceString:"Other UI"}]);
  card.regexScripts = [{...card.regexScripts[0],id:"character-regex-ambiguous",findRegex:"edited"}];
  assert.equal(normalizeStoredCharacterCard(card).regexScripts[0].id,"character-regex-ambiguous");
  const missing = createCard([{scriptName:"No source ID",findRegex:"fixture"}]);
  missing.regexScripts[0].id = "character-regex-without-source";
  assert.equal(normalizeStoredCharacterCard(missing),missing);
  const assigned = createCard(); assigned.regexScripts[0].id="user-assigned";
  assert.equal(normalizeStoredCharacterCard(assigned),assigned);
});
