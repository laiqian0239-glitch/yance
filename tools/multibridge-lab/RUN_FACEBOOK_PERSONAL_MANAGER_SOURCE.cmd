@echo off
setlocal EnableExtensions

set "MANAGER_REPO=https://github.com/mautrix/manager.git"
set "MANAGER_COMMIT=d2c08e60c7a877602bc6da2961daf2daffcff79b"
set "MANAGER_VERSION=0.2.1"
set "MANAGER_ROOT=%LOCALAPPDATA%\YanceLab\mautrix-manager-v0.2.1"
set "MANAGER_DIR=%MANAGER_ROOT%\source"
set "RC=1"

where git.exe >nul 2>&1
if errorlevel 1 goto :missing_git
where node.exe >nul 2>&1
if errorlevel 1 goto :missing_node
where npm.cmd >nul 2>&1
if errorlevel 1 goto :missing_npm

node --version
if errorlevel 1 goto :missing_node
call npm --version
if errorlevel 1 goto :missing_npm
for /f "usebackq delims=" %%V in (`node -p "Number(process.versions.node.split('.')[0])"`) do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto :bad_node
if %NODE_MAJOR% LSS 22 goto :bad_node

if not exist "%MANAGER_ROOT%" mkdir "%MANAGER_ROOT%" >nul 2>&1
if not exist "%MANAGER_DIR%\.git" (
  if exist "%MANAGER_DIR%" goto :occupied_source
  git clone --no-checkout --filter=blob:none "%MANAGER_REPO%" "%MANAGER_DIR%"
  if errorlevel 1 goto :git_red
)

for /f "usebackq delims=" %%U in (`git -C "%MANAGER_DIR%" remote get-url origin`) do set "ORIGIN_URL=%%U"
if /I not "%ORIGIN_URL%"=="%MANAGER_REPO%" goto :origin_red

git -C "%MANAGER_DIR%" fetch --depth=1 origin %MANAGER_COMMIT%
if errorlevel 1 goto :git_red
git -C "%MANAGER_DIR%" checkout --detach %MANAGER_COMMIT%
if errorlevel 1 goto :git_red
git -C "%MANAGER_DIR%" reset --hard %MANAGER_COMMIT% >nul
if errorlevel 1 goto :git_red
git -C "%MANAGER_DIR%" clean -ffd >nul
if errorlevel 1 goto :git_red

for /f "usebackq delims=" %%H in (`git -C "%MANAGER_DIR%" rev-parse HEAD`) do set "ACTUAL_HEAD=%%H"
if /I not "%ACTUAL_HEAD%"=="%MANAGER_COMMIT%" goto :identity_red
node -e "const p=require(process.argv[1]);if(p.name!=='mautrix-manager'||p.version!=='0.2.1'||p.devDependencies?.electron!=='43.2.0')process.exit(1)" "%MANAGER_DIR%\package.json"
if errorlevel 1 goto :identity_red
echo UPSTREAM_MANAGER_SOURCE_GREEN

pushd "%MANAGER_DIR%"
call npm ci --include=dev
if errorlevel 1 (
  popd
  goto :npm_red
)
echo UPSTREAM_MANAGER_DEPENDENCIES_GREEN

call npm run lint
if errorlevel 1 (
  popd
  goto :lint_red
)
echo UPSTREAM_MANAGER_LINT_GREEN
echo HUMAN_AUTH_REQUIRED: launching exact upstream mautrix-manager source UI.
echo Keep all Matrix and platform authorization data local to the UI.

call npm start
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto :manager_red
echo MAUTRIX_MANAGER_EXIT_GREEN
goto :done

:missing_git
echo REAL_RED: Git for Windows is required to fetch the exact upstream manager source.
goto :done
:missing_node
echo REAL_RED: Node.js 22 or newer is required to run the exact upstream manager source.
goto :done
:missing_npm
echo REAL_RED: npm is required to install the exact upstream manager dependency lock.
goto :done
:bad_node
echo REAL_RED: Node.js 22 or newer is required. Current Node.js does not meet the source-run gate.
goto :done
:occupied_source
echo REAL_RED: managed source path exists but is not an exact Git checkout: %MANAGER_DIR%
goto :done
:origin_red
echo REAL_RED: managed checkout origin is not the official mautrix/manager repository.
goto :done
:git_red
echo REAL_RED: exact upstream mautrix-manager source fetch or checkout failed.
goto :done
:identity_red
echo REAL_RED: exact upstream mautrix-manager source identity check failed.
goto :done
:npm_red
echo REAL_RED: upstream mautrix-manager dependency installation failed.
goto :done
:lint_red
echo REAL_RED: upstream mautrix-manager lint gate failed.
goto :done
:manager_red
echo REAL_RED: upstream mautrix-manager exited nonzero.
goto :done

:done
echo.
echo YANCE-MULTIBRIDGE-LAB Facebook Personal manager source launcher finished with exit code %RC%.
echo This window will remain open.
pause
exit /b %RC%
