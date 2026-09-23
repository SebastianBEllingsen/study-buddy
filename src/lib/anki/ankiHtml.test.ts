import { describe, it, expect } from "vitest";
import { answerPart, decodeEntities, htmlToCardFace, renderTemplate } from "./ankiHtml";

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
