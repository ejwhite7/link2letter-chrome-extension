# Link2Letter Chrome Extension

Link2Letter is a Chrome extension that helps you save and organize interesting links from around the web and automatically generate an RSS feed for use in newsletters.

## Features

- Save links with titles, descriptions, and custom notes
- Add tags to organize your saved links
- Remove paywalls using 12ft.io integration
- Generate RSS feeds for newsletter content
- Sort and filter saved links
- Bulk selection and management of links
- Premium features for power users

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory

## Usage

### Basic Usage

1. Click the Link2Letter icon in your Chrome toolbar
2. Enter your API key in the Settings tab (get one at [app.link2letter.com](https://app.link2letter.com))
3. Navigate to any webpage you want to save
4. Click the extension icon and use the "Save a Page" tab
5. Add title, description, notes, and tags as needed
6. Click "Save" to store the link

### Managing Links

- Use the "My Links" tab to view all saved links
- Sort links by newest/oldest
- Filter links by tags
- Bulk select links for deletion
- Edit link details directly from the list

### Premium Features

- Unlimited saved links
- Advanced RSS feed options
- Priority support

## Development

### Project Structure

- `manifest.json` - Extension configuration
- `popup.html` - Main extension interface
- `popup.js` - Interface functionality
- `popup.css` - Styling
- `background.js` - Background service worker
- `content.js` - Content script for page interaction

### Building

No build process required - this extension uses vanilla JavaScript and CSS.

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

[Add your chosen license here]

## Support

For support, please visit [app.link2letter.com](https://app.link2letter.com) or email support@link2letter.com

## Credits

Created by [Your Name/Organization]