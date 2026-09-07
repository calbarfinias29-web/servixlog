; SERVIX Local Server Installer (FAZA 8F)
; Using Inno Setup 6

#define MyAppName "SERVIX"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "SERVIX Team"
#define MyAppExeName "servix-admin.exe"
#define AppSourceDir "C:\Users\d3542\OneDrive\Desktop\proiect danu program\ce vede  angajatul\SERVIX2.0\project\dist-installer\staging"

[Setup]
AppId={{12345678-1234-1234-1234-123456789012}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppSupportURL=https://example.com/support
DefaultDirName={pf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=.\dist-installer\installer
OutputBaseFilename=SERVIX-{#MyAppVersion}-setup
; SetupIconFile removed (FAZA 8H): no .ico asset exists in the project; favicon.svg is not a valid Inno Setup icon source.
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
DisableProgramGroupPage=yes
VersionInfoVersion={#MyAppVersion}
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
ShowLanguageDialog=yes

[Languages]
Name: english; MessagesFile: compiler:Default.isl
Name: romanian; MessagesFile: compiler:Languages\Romanian.isl

[Types]
Name: full; Description: Full installation
Name: compact; Description: Minimal installation
Name: custom; Description: Custom installation; Flags: iscustom

[Components]
Name: app; Description: SERVIX Application; Types: full compact custom; Flags: fixed
Name: service; Description: Windows Service (Auto-start); Types: full; Flags: fixed
Name: shortcuts; Description: Start Menu & Desktop Shortcuts; Types: full compact

[Dirs]
Name: {pf}\{#MyAppName}\app
Name: {pf}\{#MyAppName}\scripts
Name: {commonappdata}\{#MyAppName}\data
Name: {commonappdata}\{#MyAppName}\backups
Name: {commonappdata}\{#MyAppName}\logs
Name: {commonappdata}\{#MyAppName}\config

[Files]
; Frontend
Source: {#AppSourceDir}\frontend\*; DestDir: {pf}\{#MyAppName}\app\frontend; Flags: ignoreversion recursesubdirs createallsubdirs
; Server
Source: {#AppSourceDir}\server\*; DestDir: {pf}\{#MyAppName}\app\server; Flags: ignoreversion recursesubdirs createallsubdirs
; Bundled Node.js runtime (app-local, NOT installed globally)
Source: {#AppSourceDir}\runtime\*; DestDir: {pf}\{#MyAppName}\app\runtime; Flags: ignoreversion recursesubdirs createallsubdirs
; Shared version module
Source: {#AppSourceDir}\src\version.ts; DestDir: {pf}\{#MyAppName}\app\src; Flags: ignoreversion
; Configuration
Source: {#AppSourceDir}\.env.production; DestDir: {pf}\{#MyAppName}\app; Flags: ignoreversion
Source: {#AppSourceDir}\package.json; DestDir: {pf}\{#MyAppName}\app; Flags: ignoreversion
; Scripts
Source: {#AppSourceDir}\scripts\start-service.ps1; DestDir: {pf}\{#MyAppName}\scripts; Flags: ignoreversion
Source: {#AppSourceDir}\scripts\install-service.ps1; DestDir: {pf}\{#MyAppName}\scripts; Flags: ignoreversion
Source: {#AppSourceDir}\scripts\health-check.ps1; DestDir: {pf}\{#MyAppName}\scripts; Flags: ignoreversion
Source: {#AppSourceDir}\scripts\backup-db.ps1; DestDir: {pf}\{#MyAppName}\scripts; Flags: ignoreversion
Source: {#AppSourceDir}\scripts\uninstall.ps1; DestDir: {pf}\{#MyAppName}\scripts; Flags: ignoreversion

[Icons]
Name: {group}\SERVIX Admin; Filename: http://127.0.0.1:8787/; Comment: Open SERVIX Admin (Local Server)
Name: {group}\SERVIX Server Status; Filename: http://127.0.0.1:8787/api/health; Comment: SERVIX Local Server Health
Name: {group}\Uninstall SERVIX; Filename: {uninstallexe}
Name: {commondesktop}\SERVIX Admin; Filename: http://127.0.0.1:8787/; Comment: SERVIX Local Admin; Components: shortcuts

[Run]
Filename: powershell.exe; Parameters: -NoProfile -ExecutionPolicy Bypass -File ""{pf}\{#MyAppName}\scripts\install-service.ps1"""; Flags: waituntilterminated runhidden; Description: Registering SERVIX Windows Service...
Filename: powershell.exe; Parameters: -NoProfile -ExecutionPolicy Bypass -File ""{pf}\{#MyAppName}\scripts\health-check.ps1"""; Flags: waituntilterminated; Description: Verifying installation...

[UninstallRun]
Filename: powershell.exe; Parameters: -NoProfile -ExecutionPolicy Bypass -File ""{pf}\{#MyAppName}\scripts\uninstall.ps1"""; Flags: waituntilterminated runhidden

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    { Service registration + health check are executed by the [Run] entries. }
    { Uninstall never deletes %ProgramData%\SERVIX (database, backups, logs). }
  end;
end;
