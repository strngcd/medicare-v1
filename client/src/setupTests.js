import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// jsdom lacks these; react-router needs them.
if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;
