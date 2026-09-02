# Notice — this is an unofficial fork

**This project is a customized fork of Open WebUI. This release is not
affiliated with, endorsed by, or maintained by the official Open WebUI team.**

Please direct support requests, bug reports and feature ideas about this fork
to <https://github.com/OGMatrix/open-webui> — not to the upstream project,
its maintainers, or its community channels. Problems introduced here are not
theirs to answer for.

The official project lives at <https://github.com/open-webui/open-webui> and
<https://openwebui.com>. If you want Open WebUI itself, get it there.

## What is different here

This fork adds interface and integration work on top of upstream. Every
release lists its own changes and the upstream commit it was built on; see
[CHANGELOG-FORK.md](CHANGELOG-FORK.md). Upstream's own changelog stays in
[CHANGELOG.md](CHANGELOG.md), unedited.

## Licensing

The upstream software is governed by the Open WebUI License, and this fork is
distributed under the same terms. The complete texts are included with every
distribution of this fork, source and binary alike:

| File                               | What it covers                                                |
| ---------------------------------- | ------------------------------------------------------------- |
| [LICENSE](LICENSE)                 | The Open WebUI License, which applies to current code         |
| [LICENSE_HISTORY](LICENSE_HISTORY) | The MIT and BSD-3-Clause terms that still govern earlier code |
| [LICENSE_NOTICE](LICENSE_NOTICE)   | Which commits fall under which of the three                   |

Copyright (c) 2023- Open WebUI Inc. [Created by Timothy Jaeryang Baek].
Modifications in this fork are copyright their respective authors and are
released under the same terms as the code they modify.

## Branding

The Open WebUI License permits redistribution of modified versions, and
separately forbids altering, removing, obscuring or replacing Open WebUI
branding outside three narrow exceptions.

**This fork does not touch that branding.** The name, the logo, and the
identifiers that distinguish the software and its interfaces are left as
upstream ships them. Nothing here is white-labelled, co-branded, or renamed,
so the restriction is not engaged in the first place — rather than relying on
the small-deployment exception to excuse a change.

Neither the Open WebUI name nor the names of its contributors are used here to
endorse or promote this fork. Where this fork is published — its repository,
its releases, and the labels on its container images — it is identified as
unofficial.

## Container images

Images published from this repository carry the notice above in their OCI
labels, and ship the licence texts inside the image at `/app`. They are built
only from the sources in this repository, at the commit named by the image's
`org.opencontainers.image.revision` label.

---

This notice is a statement of what this project does and how it is licensed.
It is not legal advice.
