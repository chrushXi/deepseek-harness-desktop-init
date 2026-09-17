/* 安全 Markdown 子集：粗体/斜体/行内码/围栏代码/列表/链接/标题 */
(function (global) {
  "use strict";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inline(text) {
    let out = escapeHtml(text);
    // code first
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    // bold
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // italic
    out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
    // links [text](url) — only http(s)
    out = out.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    );
    return out;
  }

  function renderMarkdown(src) {
    const text = String(src == null ? "" : src);
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let i = 0;
    let listOpen = null; // 'ul' | 'ol'
    const closeList = () => {
      if (listOpen) {
        html.push(`</${listOpen}>`);
        listOpen = null;
      }
    };

    while (i < lines.length) {
      const line = lines[i];

      // fenced code
      if (/^```/.test(line)) {
        closeList();
        const lang = line.slice(3).trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++; // skip closing
        html.push(
          `<pre class="md-pre"${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}><code>${escapeHtml(buf.join("\n"))}</code></pre>`
        );
        continue;
      }

      // heading
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        closeList();
        const level = h[1].length;
        html.push(`<h${level} class="md-h${level}">${inline(h[2])}</h${level}>`);
        i++;
        continue;
      }

      // ul
      const ul = /^[-*]\s+(.*)$/.exec(line);
      if (ul) {
        if (listOpen !== "ul") {
          closeList();
          html.push('<ul class="md-ul">');
          listOpen = "ul";
        }
        html.push(`<li>${inline(ul[1])}</li>`);
        i++;
        continue;
      }

      // ol
      const ol = /^\d+\.\s+(.*)$/.exec(line);
      if (ol) {
        if (listOpen !== "ol") {
          closeList();
          html.push('<ol class="md-ol">');
          listOpen = "ol";
        }
        html.push(`<li>${inline(ol[1])}</li>`);
        i++;
        continue;
      }

      // blank
      if (!line.trim()) {
        closeList();
        i++;
        continue;
      }

      // paragraph (merge consecutive plain lines lightly)
      closeList();
      const para = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^```/.test(lines[i]) &&
        !/^(#{1,4})\s+/.test(lines[i]) &&
        !/^[-*]\s+/.test(lines[i]) &&
        !/^\d+\.\s+/.test(lines[i])
      ) {
        para.push(lines[i]);
        i++;
      }
      html.push(`<p class="md-p">${inline(para.join("\n")).replace(/\n/g, "<br>")}</p>`);
    }
    closeList();
    return html.join("\n");
  }

  global.DshMd = { renderMarkdown, escapeHtml };
})(typeof window !== "undefined" ? window : globalThis);
