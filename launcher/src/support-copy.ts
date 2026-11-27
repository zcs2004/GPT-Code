import type { Language } from "./types";

const en = {
  group: "Support",
  technicalSupport: "Technical Support",
  technicalSupportTitle: "Technical Support",
  technicalSupportSubtitle: "Get help with GPT Code setup, MCP connections, updates, and runtime issues.",
  supportPrice: "¥6 per session",
  supportPriceBody: "One session covers one clearly scoped issue. Scan the QR code below to add the support contact on WeChat.",
  contactTitle: "Contact",
  contactBody: "When adding the contact, mention GPT Code and briefly describe the issue so the session can start faster.",
  contactQrAlt: "WeChat QR code for GPT Code technical support",
  donation: "Donate",
  donationTitle: "Support GPT Code",
  donationSubtitle: "Thank you for helping independent development continue.",
  donationBody: "If GPT Code has been useful to you, you are welcome to support future maintenance with any amount. Donations are voluntary and do not affect product features or support priority.",
  alipay: "Alipay",
  wechatPay: "WeChat Pay",
  alipayQrAlt: "Alipay donation QR code",
  wechatPayQrAlt: "WeChat Pay donation QR code",
} as const;

type SupportCopy = { [K in keyof typeof en]: string };

const zhCN: SupportCopy = {
  group: "支持",
  technicalSupport: "技术支持",
  technicalSupportTitle: "技术支持",
  technicalSupportSubtitle: "为 GPT Code 安装配置、MCP 连接、软件更新和运行问题提供协助。",
  supportPrice: "6 元 / 次",
  supportPriceBody: "一次技术支持对应一个边界清晰的问题。请扫描下方二维码添加技术支持微信。",
  contactTitle: "联系方式",
  contactBody: "添加时请备注 GPT Code，并简单说明遇到的问题，方便更快开始处理。",
  contactQrAlt: "GPT Code 技术支持微信二维码",
  donation: "捐款",
  donationTitle: "支持 GPT Code",
  donationSubtitle: "感谢你支持独立开发和后续维护。",
  donationBody: "如果 GPT Code 对你有所帮助，欢迎随心支持后续开发，金额不限。捐赠完全自愿，不影响软件功能或技术支持顺序。",
  alipay: "支付宝",
  wechatPay: "微信支付",
  alipayQrAlt: "支付宝捐款二维码",
  wechatPayQrAlt: "微信支付捐款二维码",
};

const zhTW: SupportCopy = {
  group: "支援",
  technicalSupport: "技術支援",
  technicalSupportTitle: "技術支援",
  technicalSupportSubtitle: "協助處理 GPT Code 安裝設定、MCP 連線、軟體更新與執行問題。",
  supportPrice: "人民幣 6 元 / 次",
  supportPriceBody: "一次技術支援對應一個範圍明確的問題。請掃描下方 QR Code 加入技術支援微信。",
  contactTitle: "聯絡方式",
  contactBody: "加入時請註明 GPT Code，並簡單描述遇到的問題，以便更快開始處理。",
  contactQrAlt: "GPT Code 技術支援微信 QR Code",
  donation: "捐款",
  donationTitle: "支持 GPT Code",
  donationSubtitle: "感謝你支持獨立開發與後續維護。",
  donationBody: "如果 GPT Code 對你有幫助，歡迎隨心支持後續開發，金額不限。捐款完全自願，不影響軟體功能或技術支援順序。",
  alipay: "支付寶",
  wechatPay: "微信支付",
  alipayQrAlt: "支付寶捐款 QR Code",
  wechatPayQrAlt: "微信支付捐款 QR Code",
};

const ja: SupportCopy = {
  group: "サポート",
  technicalSupport: "技術サポート",
  technicalSupportTitle: "技術サポート",
  technicalSupportSubtitle: "GPT Code のセットアップ、MCP 接続、アップデート、実行時の問題をサポートします。",
  supportPrice: "1 回 6 元",
  supportPriceBody: "1 回のサポートは、範囲が明確な 1 件の問題を対象とします。下の QR コードから WeChat のサポート連絡先を追加してください。",
  contactTitle: "お問い合わせ",
  contactBody: "追加時に GPT Code と記載し、問題を簡単に説明すると、より早く対応を開始できます。",
  contactQrAlt: "GPT Code 技術サポートの WeChat QR コード",
  donation: "寄付",
  donationTitle: "GPT Code を支援",
  donationSubtitle: "個人開発と継続的なメンテナンスへのご支援に感謝します。",
  donationBody: "GPT Code がお役に立てた場合は、任意の金額で今後の開発を支援していただけます。寄付は完全に任意で、機能やサポートの優先順位には影響しません。",
  alipay: "Alipay",
  wechatPay: "WeChat Pay",
  alipayQrAlt: "Alipay 寄付用 QR コード",
  wechatPayQrAlt: "WeChat Pay 寄付用 QR コード",
};

const ko: SupportCopy = {
  group: "지원",
  technicalSupport: "기술 지원",
  technicalSupportTitle: "기술 지원",
  technicalSupportSubtitle: "GPT Code 설치, MCP 연결, 업데이트 및 실행 문제를 지원합니다.",
  supportPrice: "1회 6위안",
  supportPriceBody: "한 번의 기술 지원은 범위가 명확한 문제 한 건을 대상으로 합니다. 아래 QR 코드를 스캔하여 WeChat 지원 연락처를 추가하세요.",
  contactTitle: "연락처",
  contactBody: "연락처를 추가할 때 GPT Code라고 적고 문제를 간단히 설명하면 더 빠르게 지원을 시작할 수 있습니다.",
  contactQrAlt: "GPT Code 기술 지원 WeChat QR 코드",
  donation: "후원",
  donationTitle: "GPT Code 후원",
  donationSubtitle: "독립 개발과 지속적인 유지 관리를 지원해 주셔서 감사합니다.",
  donationBody: "GPT Code가 도움이 되었다면 원하는 금액으로 향후 개발을 후원할 수 있습니다. 후원은 전적으로 자발적이며 기능이나 기술 지원 순서에 영향을 주지 않습니다.",
  alipay: "Alipay",
  wechatPay: "WeChat Pay",
  alipayQrAlt: "Alipay 후원 QR 코드",
  wechatPayQrAlt: "WeChat Pay 후원 QR 코드",
};

export function supportCopyFor(language: Language): SupportCopy {
  if (language === "zh-CN") return zhCN;
  if (language === "zh-TW") return zhTW;
  if (language === "ja") return ja;
  if (language === "ko") return ko;
  return en;
}
