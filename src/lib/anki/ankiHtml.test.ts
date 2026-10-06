import { describe, it, expect } from "vitest";
import { answerPart, decodeEntities, htmlToCardFace, needsRichRendering, renderTemplate } from "./ankiHtml";

describe("renderTemplate", () => {
  const ctx = { fields: { Front: "hund", Back: "dog", Extra: "", Text: "{{c1::Oslo}} and {{c2::Bergen::city}}" } };

  it("substitutes fields and drops {{FrontSide}}", () => {
    expect(renderTemplate("{{FrontSide}}<hr id=answer>{{Back}}", "back", ctx)).toBe("<hr id=answer>dog");
  });

  it("shows {{#Field}} sections only when the field has content, {{^Field}} only when empty", () => {
    expect(renderTemplate("{{#Front}}F{{/Front}}{{#Extra}}E{{/Extra}}{{^Extra}}no extra{{/Extra}}", "front", ctx)).toBe(
      "Fno extra"
    );
  });

  it("handles nested sections", () => {
    expect(renderTemplate("{{#Front}}[{{#Back}}{{Back}}{{/Back}}]{{/Front}}", "front", ctx)).toBe("[dog]");
  });

  it("renders the active cloze as its hint on the front and its answer on the back", () => {
    expect(renderTemplate("{{cloze:Text}}", "front", { ...ctx, clozeOrdinal: 2 })).toBe("Oslo and [city]");
    expect(renderTemplate("{{cloze:Text}}", "front", { ...ctx, clozeOrdinal: 1 })).toBe("[…] and Bergen");
    expect(renderTemplate("{{cloze:Text}}", "back", { ...ctx, clozeOrdinal: 2 })).toBe("Oslo and Bergen");
  });

  it("hides type-in boxes on the front but shows the expected answer on the back", () => {
    expect(renderTemplate("{{Front}} {{type:Back}}", "front", ctx)).toBe("hund ");
    expect(renderTemplate("{{type:Back}}", "back", ctx)).toBe("dog");
  });

  it("fills in pseudo-fields", () => {
    expect(renderTemplate("{{Deck}} / {{Subdeck}}", "front", { ...ctx, deck: "A::B" })).toBe("A::B / B");
  });
});

describe("htmlToCardFace", () => {
  it("turns block tags into line breaks and decodes entities", () => {
    expect(htmlToCardFace("<div>a &amp; b</div><div>c&nbsp;d</div><ul><li>x</li><li>y</li></ul>").text).toBe(
      "a & b\nc d\n• x\n• y"
    );
  });

  it("keeps <br> line breaks, including blank lines, but not source newlines", () => {
    expect(htmlToCardFace("a<br><br>b\n   c").text).toBe("a\n\nb c");
  });

  it("extracts images, videos (incl. <source>), audio and [sound:] refs in order", () => {
    const face = htmlToCardFace(
      '<img src="a.png"><video controls><source src="https://x.test/v.mp4"></video><audio src="b.ogg"></audio>[sound:c.mp3][sound:d.webm]'
    );
    expect(face.media).toEqual([
      { type: "video", url: "https://x.test/v.mp4" },
      { type: "audio", file: "b.ogg" },
      { type: "image", file: "a.png" },
      { type: "audio", file: "c.mp3" },
      { type: "video", file: "d.webm" },
    ]);
    expect(face.text).toBe("");
  });

  it("drops media with unsafe schemes and de-duplicates repeats", () => {
    const face = htmlToCardFace('<img src="javascript:alert(1)"><img src="a.png"><img src="a.png">');
    expect(face.media).toEqual([{ type: "image", file: "a.png" }]);
  });

  it("removes scripts and styles entirely", () => {
    expect(htmlToCardFace("<style>.x{}</style><script>alert(1)</script>ok").text).toBe("ok");
  });

  it("converts MathJax delimiters to $ / $$", () => {
    expect(htmlToCardFace("\\(a^2\\) and \\[b\\]").text).toBe("$a^2$ and $$b$$");
  });
});

describe("answerPart", () => {
  it("keeps only what follows Anki's answer divider", () => {
    expect(answerPart("front<hr id=answer>back")).toBe("back");
    expect(answerPart('front<hr id="answer" />back')).toBe("back");
    expect(answerPart("no divider")).toBe("no divider");
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities and leaves unknown ones alone", () => {
    expect(decodeEntities("&aring;&#248;&#xe6; &bogus;")).toBe("åøæ &bogus;");
  });
});

describe("needsRichRendering", () => {
  it("is false for text, images, audio, video and basic formatting", () => {
    expect(needsRichRendering("{{Front}}", "{{FrontSide}}<hr id=answer>{{Back}}", "<div>hi<br><b>x</b><img src=a.png></div>")).toBe(false);
  });

  it("is true for scripts, links, tables and anything styled by class or style", () => {
    expect(needsRichRendering("<script>1</script>")).toBe(true);
    expect(needsRichRendering('<a href="https://x.test">x</a>')).toBe(true);
    expect(needsRichRendering("<table><tr><td>1</td></tr></table>")).toBe(true);
    expect(needsRichRendering('<div class="card-front">x</div>')).toBe(true);
    expect(needsRichRendering('<span style="color:red">x</span>')).toBe(true);
  });
});

describe("renderTemplate for display as HTML", () => {
  const ctx = { fields: { Text: "{{c1::Oslo::city}} is in {{c2::Norway}}", Hint: "a hint" }, clozeOrdinal: 1, rich: true };

  it("renders the active cloze as a styled span and keeps the answer on the back", () => {
    expect(renderTemplate("{{cloze:Text}}", "front", ctx)).toBe(
      '<span class="cloze" data-cloze="Oslo" data-ordinal="1">[city]</span> is in Norway'
    );
    expect(renderTemplate("{{cloze:Text}}", "back", ctx)).toContain('<span class="cloze" data-cloze="Oslo" data-ordinal="1">Oslo</span>');
  });

  it("expands {{FrontSide}} to the rendered front", () => {
    expect(renderTemplate("{{FrontSide}}|{{Hint}}", "back", { ...ctx, frontSide: "<b>F</b>" })).toBe("<b>F</b>|a hint");
  });

  it("makes {{hint:Field}} a click-to-reveal link", () => {
    const out = renderTemplate("{{hint:Hint}}", "front", ctx);
    expect(out).toContain('class="hint"');
    expect(out).toContain("a hint");
  });

  it("drops elements a template hides when flattening to text", () => {
    expect(htmlToCardFace('<div>Hello</div><span style="display:none">Deck::Name</span>').text).toBe("Hello");
  });
});
