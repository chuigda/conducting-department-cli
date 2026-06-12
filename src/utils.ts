/**
 * Shared file utilities.
 */

import { parse as parseToml } from 'smol-toml'

/**
 * Read and parse a TOML file. Throws if the file doesn't exist.
 */
export async function readTomlFile(filePath: string): Promise<Record<string, any>> {
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
        throw new Error(`File not found: ${filePath}`)
    }
    const text = await file.text()
    return parseToml(text) as Record<string, any>
}
