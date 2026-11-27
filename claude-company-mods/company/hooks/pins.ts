// The versions setup installs. RTK's hashes are copied from the v1.2.1 release's checksums.txt;
// the Linux builds are musl (static), so they run on any distribution.
export const RTK = {
  version: 'v1.2.1',
  assets: {
    'linux-x64': { name: 'rtk-x86_64-unknown-linux-musl.tar.gz', sha256: '75f64525711be935657a6b228d929c24bd9d1ab7d640ea374a8b913e5b5bac05' },
    'linux-arm64': { name: 'rtk-aarch64-unknown-linux-musl.tar.gz', sha256: 'cae1a911eda9e898dbb90039436e9d53922b20afb1e3e4ae341f749eb62b7781' },
    'darwin-x64': { name: 'rtk-x86_64-apple-darwin.tar.gz', sha256: '107e272253c0aa36c9c85fbf9dd188bdb58d86c6ba9a85b49122420baf6e4c5c' },
    'darwin-arm64': { name: 'rtk-aarch64-apple-darwin.tar.gz', sha256: '3bc2a92f1d3e404ef99c200cddcc0f4917d6c4ed5b127a751938a96f57d4ed9a' },
    'win32-x64': { name: 'rtk-x86_64-pc-windows-msvc.zip', sha256: '08671cb746e779c50dc530eec0114a7cd6cbbd1ea4f66c98dd9f0572f5f96c43' },
  } as Record<string, { name: string; sha256: string }>,
}

export const GRAPHIFY = 'graphifyy==0.9.120'
