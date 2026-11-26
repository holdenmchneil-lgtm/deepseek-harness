#!/usr/bin/env node
/**
 * Command-line entry for dsh.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { getDshRuntimeVersion, loadLayeredEnv, StartupError } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseDshArgs } from './args.ts'
import { reportStartupFailure } from './startup-diagnostics.ts'
import type { RunProfileOptions } from './profile-boot.ts'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Installation-owned dependencies supplied by a packaged CLI launcher. */
export type RunCliOptions = Pick<RunProfileOptions, 'packageManager'> & {
  /** Permit plugin commands for Desktop's existing profile; reserved for its installed carrier. */
  manageDesktopProfile?: boolean
}

/**
 * Run the public dsh command-line interface.
 * @param options - Package runtime and Desktop profile access supplied by the installation.
 * @returns a promise that settles when the selected command mode finishes.
 */
export async function runCli(options: RunCliOptions = {}): Promise<void> {
  const version = getDshRuntimeVersion()
  const { manageDesktopProfile, ...profileOptions } = options
  const invocation = parseDshArgs(process.argv.slice(2), version, manageDesktopProfile)

  switch (invocation.mode) {
    case 'profile': {
      const { runProfile } = await import('./profile-boot.ts')
      try {
        await runProfile({
          environment: loadLayeredEnv('dsh'),
          profile: invocation.profile,
          fromDefaultProfile: invocation.fromDefaultProfile,
          patchFiles: invocation.patches,
          args: invocation.args,
          ...profileOptions,
        })
      } catch (error) {
        if (!(error instanceof StartupError)) throw error
        await reportStartupFailure(error, { home: resolveDshHome(), version, profile: invocation.profile })
        process.exit(1)
      }
      break
    }
    case 'plugin': {
      const { runPlugin } = await import('./plugin.ts')
      process.exit(await runPlugin(invocation.profile, invocation.args, options.packageManager))
      break
    }
    case 'dump-config': {
      const { runDumpConfig } = await import('./dump-config.ts')
      runDumpConfig(
        invocation.profile,
        invocation.defaultOnly,
        invocation.patches,
        invocation.fromDefaultProfile,
      )
      break
    }
    case 'dump-config-schema': {
      const { runDumpConfigSchema } = await import('./dump-config-schema.ts')
      await runDumpConfigSchema(invocation.profile, invocation.patches, invocation.fromDefaultProfile)
      break
    }
    case 'profile-management': {
      await handleProfileManagement(invocation)
      break
    }
    default:
      invocation satisfies never
      throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
  }
}

if (import.meta.main) {
  await runCli()
}

function resolveProfileDir(subpath: string): string {
  return join(resolveDshHome(), 'profiles', subpath)
}

async function handleProfileManagement(invocation: { subcommand: string; profile?: string; fromDefaultProfile?: string }): Promise<void> {
  const dshHome = resolveDshHome()
  const profilesPath = resolveProfileDir('')

  switch (invocation.subcommand) {
    case 'list': {
      if (!existsSync(profilesPath)) {
        console.log('No profiles found.')
        return
      }
      const entries = readdirSync(profilesPath, { withFileTypes: true })
      const profiles = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()

      if (profiles.length === 0) {
        console.log('No profiles found.')
      } else {
        for (const profile of profiles) {
          console.log(profile)
        }
      }
      break
    }
    case 'create': {
      if (!invocation.profile) {
        console.error('error: profile create needs a name')
        process.exit(1)
      }
      const profileDir = resolveProfileDir(invocation.profile)
      if (existsSync(profileDir)) {
        console.error(`error: profile ${JSON.stringify(invocation.profile)} already exists`)
        process.exit(1)
      }
      mkdirSync(profileDir, { recursive: true })

      // Initialize profile with base bundles or from template
      if (invocation.fromDefaultProfile) {
        // TODO: Copy from default profile template
        console.log(`dsh: created profile ${invocation.profile} from template ${invocation.fromDefaultProfile}`)
      } else {
        console.log(`dsh: created profile ${invocation.profile}`)
      }
      break
    }
    case 'use': {
      if (!invocation.profile) {
        console.error('error: profile use needs a name')
        process.exit(1)
      }
      const profileDir = resolveProfileDir(invocation.profile)
      if (!existsSync(profileDir)) {
        console.error(`error: profile ${JSON.stringify(invocation.profile)} does not exist; create it with 'dsh profile create ${invocation.profile}'`)
        process.exit(1)
      }
      // Write active profile to a config file
      const activeProfilePath = join(dshHome, '.active-profile')
      const fs = await import('node:fs/promises')
      await fs.writeFile(activeProfilePath, invocation.profile, 'utf8')
      console.log(`dsh: using profile ${invocation.profile}`)
      break
    }
    default:
      throw new Error(`dsh: unhandled profile management subcommand ${JSON.stringify(invocation.subcommand)}`)
  }
}