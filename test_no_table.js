
const fs = require("fs");
const html = `<h1>PATRICK MITCHELL</h1>
<p class="contact">Gladstone, MO | (515) 771-3320 | pmitchell.dev@gmail.com</p>
<h2>PROFESSIONAL SUMMARY</h2>
<p>Summary paragraph</p>
<h2>PROFESSIONAL EXPERIENCE</h2>
<div class="job-header"><span>Job Title</span><span>Location  Dates</span></div>
<div class="job-sub"><em>Company</em></div>
<ul><li>Bullet 1</li><li>Bullet 2</li></ul>`;

function processTableHtml(tableInnerHtml) { return "<w:tbl>...</w:tbl>"; }
function createParagraphXml(inner, opts) { return `<w:p>[${opts.style||""}]${inner}</w:p>`; }
function createTabbedParagraphXml(l, r, isSub) { return `<w:p>Tab[${l} | ${r}]</w:p>`; }
function decodeHtmlEntities(s) { return s; }
function escapeXml(s) { return s; }

function processBlockHtml(htmlSnippet) {
  let xml = "";
  const textWithNewlines = htmlSnippet.replace(/<br\s*\/?>/gi, "\n");
  const blockRegex = /(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|<p[^>]*>[\s\S]*?<\/p>|<li[^>]*>[\s\S]*?<\/li>|<div[^>]*>[\s\S]*?<\/div>)/gi;
  const blocks = textWithNewlines.split(blockRegex).filter(b => b && b.trim());

  blocks.forEach(block => {
    let trimmed = block.trim();
    if (!trimmed) return;
    if (/^<h1/i.test(trimmed)) {
      const inner = trimmed.replace(/^<h1[^>]*>/i, "").replace(/<\/h1>$/i, "");
      xml += createParagraphXml(inner, { style: "Heading1", align: "center", before: 180, after: 60 });
    } else if (/^<h2/i.test(trimmed)) {
      const inner = trimmed.replace(/^<h2[^>]*>/i, "").replace(/<\/h2>$/i, "");
      xml += createParagraphXml(inner, { style: "Heading2", borderBottom: true, before: 200, after: 100 });
    } else if (/^<h3/i.test(trimmed)) {
      const inner = trimmed.replace(/^<h3[^>]*>/i, "").replace(/<\/h3>$/i, "");
      xml += createParagraphXml(inner, { style: "Heading3", before: 140, after: 60 });
    } else if (/^<li/i.test(trimmed)) {
      const inner = trimmed.replace(/^<li[^>]*>/i, "").replace(/<\/li>$/i, "");
      xml += createParagraphXml(inner, { isList: true, after: 60 });
    } else if (/<span/i.test(trimmed) && (trimmed.includes("justify-content") || trimmed.includes("job-header") || trimmed.includes("job-sub") || trimmed.includes("between"))) {
      const isSub = trimmed.includes("job-sub") || trimmed.includes("italic");
      const spans = trimmed.match(/<(?:span|p|div)[^>]*>([\s\S]*?)<\/(?:span|p|div)>/gi) || [];
      if (spans.length >= 2) {
        const leftText = spans[0].replace(/<[^>]*>/g, "");
        const rightText = spans[spans.length - 1].replace(/<[^>]*>/g, "");
        xml += createTabbedParagraphXml(leftText, rightText, isSub);
      } else {
        const inner = trimmed.replace(/<\/?(div|p)[^>]*>/gi, "");
        xml += createParagraphXml(inner, { after: 100 });
      }
    } else {
      const lines = trimmed.split("\n");
      lines.forEach(line => {
        const lineText = line.replace(/<\/?(p|div|ul|ol|section|article)[^>]*>/gi, "").trim();
        if (lineText) {
          const isContactLine = lineText.includes("|") || lineText.includes("@");
          xml += createParagraphXml(lineText, { align: isContactLine ? "center" : "left", after: isContactLine ? 160 : 100 });
        }
      });
    }
  });
  return xml;
}

let clean = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n");
console.log(processBlockHtml(clean));

