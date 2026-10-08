# WebGAL LoveLive 包管理器

Electron 桌面应用，用于浏览、下载和安装模型、动作、表情及其他资源包。

## 选择工程

启动后可从应用目录下的 `games` 选择工程，或点击“浏览本地目录”选择任意位置的工程。工程根目录需包含 `webgal-engine.json`；选择其下的 `game` 目录也可识别。顶部可切换工程或刷新安装状态。开发时应用目录为项目目录，打包后为可执行文件所在目录。

引擎 ID 为 `webgal-lovelive.lovelive` 时显示全部资源页签；其他引擎只显示“其他”页签。

模型按清单的 `installPath` 检测目录，其他资源按 `checkPath` 检测。目录存在且非空、或指定文件存在，即显示“已安装”角标，按钮变为“重新下载”；点击后需要确认。返回应用窗口时会刷新状态。

选择模型后点击“下载并安装”，模型将安装到当前工程的 `game/3d/figure/团体/角色/模型目录`。重新下载会替换该模型目录内的文件；下载或解压失败时保留原模型，并弹出失败原因，可点击“重试”。

## 运行

安装 Node.js 22.18 或更高版本，在项目目录执行：

```shell
npm install
npm run dev
```

命令会自动打开 Electron 桌面窗口，请在该窗口中操作。本地工程选择和安装检测需要桌面应用提供的文件访问能力。

清单地址配置在 `package-manager.config.json` 中，默认使用以下资源服务。开发时该文件放在项目根目录，打包后放在可执行文件同级目录。需要更换下载源时，修改对应地址后重启应用；若界面已显示清单错误，也可点击“重试”重新读取配置。

```json
{
  "modelCatalogUrl": "https://webgal-lovelive-pkg.ganbaru.by/models.json",
  "resourceCatalogUrl": "https://webgal-lovelive-pkg.ganbaru.by/resources.json"
}
```

两个地址分别指向模型清单和其他资源清单，均需使用完整的 HTTP 或 HTTPS 地址。配置文件缺失、内容错误或清单无法访问时，界面会提示原因并提供“重试”。

构建后启动桌面应用：

```shell
npm run build
npm start
```

`npm test` 检查清单、分类、工程识别及资源安装；先执行 `npm run build`，再执行 `npm run test:electron` 验证桌面界面。

## 打包 Windows 程序

在项目目录执行：

```shell
npm run pack:win
```

生成的 `release/WebGAL-LoveLive-Package-Manager.exe` 是免安装的单文件程序。将它与 `release/package-manager.config.json` 放到 Terre 主程序同级目录即可运行，也可放在其他目录并浏览选择工程。程序从该 EXE 所在目录读取配置文件和 `games`。

打包时会将项目根目录的 `package-manager.config.json` 复制到 `release`。分发时一并提供上述 EXE 和配置文件。

## 资源清单

模型与其他资源分别使用一份清单，每份清单的根是条目数组，分别通过配置文件中的两个地址加载。

模型条目：

```json
{
  "name": "ch0109_co0002_member",
  "description": "黑泽露比 · 冬季校服",
  "path": "Aqours/09黑泽露比/ch0109_co0002_member",
  "installPath": "3d/figure/Aqours/09黑泽露比/ch0109_co0002_member",
  "url": "ch0109_co0002_member.zip",
  "preview": "ch0109_co0002_member.webp",
  "bytes": 1270249,
  "unpackedBytes": 2163159,
  "sha256": "9348f90ba743acd4385ea7b94b03063a676b86350e70e1298bb3273c590ac933"
}
```

`path` 是包内从团体名开始的模型目录，用于生成浏览目录；`url` 和 `preview` 支持完整 URL 或相对于对应清单 URL 的地址。`bytes` 是 ZIP 大小，`unpackedBytes` 是解压后文件总大小，`sha256` 用于下载完整性校验。文件夹使用排序后内部首个模型的预览图。

动作与其他资源条目：

```json
{
  "type": "live2d_mot_exp",
  "name": "MyGO 动作与表情",
  "description": "BanG Dream 参数动作与表情资源。",
  "installPath": "3d/mtn_exp/mygo",
  "checkPath": "3d/mtn_exp/mygo",
  "url": "https://example.invalid/mygo-mtn-exp.zip"
}
```

`type` 取值为 `motion`、`live2d_mot_exp`、`figure`、`background`、`bgm`。前两种显示在“动作”，后三种显示在“其他”。`figure` 用于 Live2D 等立绘资源包。

两份清单均可选填 `preview` 指定预览图 URL；未填写或加载失败时显示对应资源类型的默认图。`description` 中使用 `\n` 换行。

资源 ZIP 按以下目录解压，保留 ZIP 内的路径。重新下载会覆盖包内同名文件，保留其他文件。

| type | 解压目录（相对于 game） |
| --- | --- |
| motion | 3d/motion |
| live2d_mot_exp | 3d/mtn_exp |
| figure | figure |
| background | background |
| bgm | bgm |

路径均相对于游戏 `game` 目录。模型的 `installPath` 填写其 `config.json` 所在目录，用于展示及安装检测。

手动维护的资源清单有两个独立字段：`installPath` 是展示给用户的安装目录；`checkPath` 是实际检测的目录或文件。例如音乐包可以显示 `bgm/exchange`，检测 `bgm/exchange/scene1.aac`。

## 代码结构

- `electron/`：桌面窗口、工程访问、清单下载及资源安装。
- `src/catalog.ts`：清单类型、目录生成和资源分类。
- `src/App.tsx`：目录浏览、网格、详情及下载进度。
- `tests/`：目录逻辑及 Electron 界面测试。

## 生成式人工智能使用声明

本项目绝大多数代码与文档均由生成式人工智能（Generative AI）工具生成。核心路线和方案由作者与 AI 共同讨论确定。

由于作者仅对最终呈现的功能效果进行验收，未对代码进行深度的代码审查，因此代码库可能存在较多技术债务与不规范之处。

如您在使用中遇到问题，或愿意帮助优化、重构底层代码，欢迎通过 Issue 或 Pull Request 参与共建。
