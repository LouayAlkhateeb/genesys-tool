# Custom Card Tags System

This system allows you to add custom tags to cards without modifying the existing card JSON files. Tags are used for background filtering and can be managed through separate mapping files.

## How It Works

1. **Tag Mapping Files**: Each tag is defined in a separate JSON file in the `data/tags/` directory
2. **Background Processing**: Tags are loaded during app initialization and merged with card data
3. **Filtering**: Tags can be filtered using the tag filter bar (shown only in main browsing view and 0-point staples list)

## File Format

Each tag file should follow this JSON structure:

```json
{
  "name": "Tag Name",
  "description": "Description of what this tag represents",
  "card_ids": [12345678, 87654321, ...]
}
```

- `name`: The display name of the tag (appears on filter buttons)
- `description`: Optional description for documentation purposes
- `card_ids`: Array of card IDs that should have this tag

## Adding New Tags

1. Create a new JSON file in the `data/tags/` directory
2. Use the format above with your desired tag name and card IDs
3. The file name should be lowercase with underscores (e.g., `new_tag.json`)
4. The system will automatically load the new tag on next app initialization

## Example Tags

### Current Tags
- **Hand Trap**: Cards that can be activated from hand during opponent's turn
- **Board Breaker**: Cards that can break opponent's established boards

### Sample Card IDs
- Hand Trap: 14558127, 73642296, 97268402
- Board Breaker: 33017964, 48130397, 12580477

## Usage

1. **Main Browsing View**: Tag filter bar appears at the top of the card grid
2. **0-Point Staples List**: Tag filter bar is also available
3. **Other Views**: Tag filter bar is hidden in category view and other lists
4. **Multi-Select**: Multiple tags can be selected simultaneously for filtering

## Technical Details

- Tags are stored in the `custom_tags` property of card objects
- Filtering uses OR logic (cards matching ANY selected tag are shown)
- Tag data is loaded asynchronously during app initialization
- The system is designed to be easily extensible with new tag types

## Troubleshooting

- If a tag doesn't appear, check that the JSON file is valid
- If card IDs don't work, verify they exist in the card database
- The tag filter bar only appears in specific views as described above