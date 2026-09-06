import { useMemo, useState } from "react";
import React from "react";
import { Eye, EyeOff, Lock, Plus, Search, TagIcon, X } from "lucide-react";
import type { Tag as TagType, Visibility } from "../types";

/** 编辑器的快捷键与粘贴行为说明，集中列出仅靠界面看不出来的隐藏能力。 */
const editorShortcutGroups: { title: string; items: [keys: string, description: string][] }[] = [
  {
    title: "键盘快捷键",
    items: [
      ["Ctrl / ⌘ + B", "加粗选中文字，没有选区时插入占位文字"],
      ["Ctrl / ⌘ + I", "斜体选中文字"],
      ["Ctrl / ⌘ + K", "把选中文字变成链接"],
      ["( [ { \" ' ` * _", "选中文字后按这些符号，用符号包裹选区，而不是替换掉选中内容"]
    ]
  },
  {
    title: "粘贴",
    items: [
      ["粘贴图片", "自动上传到图床并插入 Markdown 图片，上传期间先显示「图片上传中…」占位"],
      ["粘贴网页内容", "保留正文，并把其中的图片转存到项目图床；个别图片转存失败时保留原始外链"]
    ]
  },
  {
    title: "工具栏",
    items: [
      ["标题 引用 列表", "作用于整行而不是光标处；选中多行时逐行添加，空行自动跳过"],
      ["代码块", "两侧围栏各自独占一行，光标停在行中间时自动补换行"],
      ["加粗 斜体 行内代码 链接", "包裹选区，没有选区时插入占位文字并选中"],
      ["识别图片链接转md", "把正文里单独成行的图片 URL 转成 Markdown 图片"]
    ]
  }
];

/** 展示编辑器支持的快捷键、粘贴和工具栏说明。 */
export function EditorShortcutsDialog(props: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="login-dialog shortcuts-dialog" role="dialog" aria-modal="true" aria-label="编辑器快捷键说明">
        <div className="dialog-header">
          <h2>编辑器快捷键</h2>
          <button className="icon-button subtle" type="button" onClick={props.onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        {editorShortcutGroups.map((group) => (
          <section className="shortcuts-group" key={group.title}>
            <h3>{group.title}</h3>
            {group.items.map(([keys, description]) => (
              <div className="shortcuts-row" key={keys}>
                <kbd>{keys}</kbd>
                <span>{description}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/** 从现有标签中选择或创建新标签，并忽略大小写重复项。 */
export function TagSelector(props: {
  selectedTags: string[];
  availableTags: TagType[];
  onChange: (tags: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const normalizedSelected = useMemo(() => new Set(props.selectedTags.map((tag) => tag.toLowerCase())), [props.selectedTags]);
  const filteredTags = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return props.availableTags
      .filter((tag) => !normalizedSelected.has(tag.name.toLowerCase()))
      .filter((tag) => !normalizedQuery || tag.name.toLowerCase().includes(normalizedQuery))
      .slice(0, 8);
  }, [props.availableTags, normalizedSelected, query]);
  const canCreate = query.trim().length > 0 && !normalizedSelected.has(query.trim().toLowerCase());
  const showOptions = focused && (filteredTags.length > 0 || canCreate);

  /** 清理标签名称并忽略与已选标签大小写相同的输入。 */
  function addTag(tagName: string) {
    const cleaned = tagName.trim();
    if (!cleaned || normalizedSelected.has(cleaned.toLowerCase())) {
      setQuery("");
      return;
    }

    props.onChange([...props.selectedTags, cleaned]);
    setQuery("");
    setFocused(true);
  }

  /** 按忽略大小写的名称移除一个已选标签。 */
  function removeTag(tagName: string) {
    props.onChange(props.selectedTags.filter((tag) => tag.toLowerCase() !== tagName.toLowerCase()));
  }

  /** 使用回车添加标签，空输入时按退格移除末尾标签。 */
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag(query || filteredTags[0]?.name || "");
    }

    if (event.key === "Backspace" && !query && props.selectedTags.length > 0) {
      event.preventDefault();
      removeTag(props.selectedTags[props.selectedTags.length - 1]);
    }
  }

  return (
    <div className="tag-selector-field">
      <span className="field-label">标签</span>
      <div
        className="tag-selector"
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setFocused(false);
          }
        }}
      >
        <div className="tag-selector-input">
          {props.selectedTags.map((tag) => (
            <button className="tag-chip" type="button" key={tag} onClick={() => removeTag(tag)} title={`移除 ${tag}`}>
              {tag}
              <X size={13} />
            </button>
          ))}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            placeholder={props.selectedTags.length ? "搜索或新增标签" : "搜索标签，回车新增"}
            aria-label="搜索或新增标签"
          />
          <Search size={16} className="tag-selector-search" aria-hidden="true" />
        </div>
        {showOptions && (
          <div className="tag-options" role="listbox" aria-label="标签候选">
            {filteredTags.map((tag) => (
              <button
                className="tag-option"
                type="button"
                key={tag.slug}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(tag.name)}
              >
                <TagIcon size={14} />
                {tag.name}
              </button>
            ))}
            {canCreate && (
              <button
                className="tag-option create"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(query)}
              >
                <Plus size={14} />
                新增“{query.trim()}”
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 选择文章的公开、登录可见或密码可见模式。 */
export function SegmentedVisibility(props: { value: Visibility; onChange: (value: Visibility) => void }) {
  return (
    <div className="segmented">
      <button
        className={props.value === "public" ? "active" : ""}
        type="button"
        onClick={() => props.onChange("public")}
      >
        <Eye size={16} />
        公开
      </button>
      <button
        className={props.value === "private" ? "active" : ""}
        type="button"
        onClick={() => props.onChange("private")}
      >
        <EyeOff size={16} />
        登录可见
      </button>
      <button
        className={props.value === "password" ? "active" : ""}
        type="button"
        onClick={() => props.onChange("password")}
      >
        <Lock size={16} />
        密码可见
      </button>
    </div>
  );
}
