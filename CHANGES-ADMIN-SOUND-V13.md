# 后台语音通知 V13：去除提示音

本版基于 V12，只修改 `site/admin.html` 的后台语音通知实现：

- 彻底删除预约通知前的双音提示音（Web Audio oscillator）。
- 事件发生时直接开始日语/中文语音播报，不再人为等待 560ms。
- 保留通知开关、0–100% 音量调节、浏览器保存设置，默认 100%。
- 保留只播报月日及时间、不播报年份和顾客资料的文案。
- 不修改 D1、Worker、API、Session、预约规则和其它页面。

**重要音量上限**：Chrome/Edge Web Speech API 的 `SpeechSynthesisUtterance.volume` 只能取 0–1；
在浏览器声音和电脑音量都为最大时，单纯设置滑杆到 200% 不会真正使语音变为两倍。
若必须真实放大人声音量，需换成可通过 Web Audio `GainNode` 的音频文件/TTS 引擎（可能需准备声音素材并评估音质），
或使用更响的音箱。本版没有虚构“200%”功能。

校验：`bash tests/verify-all.sh`；另测试事件只触发语音而不产生提示音。
