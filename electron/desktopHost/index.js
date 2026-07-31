'use strict';
module.exports = {
  ...require('./DesktopHost'),
  ...require('./BackendProcessHost'),
  ...require('./CredentialVaultHost'),
  ...require('./CredentialIpcHost'),
  ...require('./CredentialCustodyHost'),
  ...require('./DesktopCredentialApplicationCoordinator'),
  ...require('./ReleaseManifestHost'),
  ...require('./startupProtocol')
};
